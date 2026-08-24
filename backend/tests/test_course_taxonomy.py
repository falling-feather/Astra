from datetime import UTC, datetime
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from app.core.config import get_settings
from app.db.session import get_session_factory, reset_database_state
from app.models import ClassGroup


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Cookie": ""}


def _login(client, username: str, role: str) -> str:
    password = "Taxonomy-test-password-123"
    registered = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "display_name": username,
            "password": password,
            "role": role,
        },
    )
    assert registered.status_code == 201, registered.json()
    logged_in = client.post("/api/auth/login", json={"username": username, "password": password})
    assert logged_in.status_code == 200, logged_in.json()
    return logged_in.json()["access_token"]


def _bootstrap_admin(client) -> str:
    password = "Taxonomy-admin-password-123"
    created = client.post(
        "/api/admin/bootstrap",
        json={
            "username": "taxonomy_admin",
            "display_name": "Taxonomy Admin",
            "password": password,
        },
    )
    assert created.status_code == 201, created.json()
    logged_in = client.post(
        "/api/auth/login",
        json={"username": "taxonomy_admin", "password": password},
    )
    assert logged_in.status_code == 200, logged_in.json()
    return logged_in.json()["access_token"]


def test_course_subject_identity_and_homeroom_visibility(client) -> None:
    teacher = _login(client, "taxonomy_teacher", "teacher")
    admin = _bootstrap_admin(client)
    school = client.post(
        "/api/schools",
        headers=_auth(teacher),
        json={"name": "Taxonomy School", "region": "Shanghai"},
    )
    assert school.status_code == 201, school.json()
    school_id = school.json()["id"]

    explicit = client.post(
        "/api/courses",
        headers=_auth(teacher),
        json={
            "school_id": school_id,
            "galaxy_key": "Astra_Core",
            "subject_key": "Physics_Mechanics",
            "course_key": "term-physics-2026",
            "title": "Physics 2026",
        },
    )
    assert explicit.status_code == 201, explicit.json()
    assert explicit.json()["galaxy_key"] == "astra-core"
    assert explicit.json()["subject_key"] == "physics-mechanics"
    assert explicit.json()["course_key"] == "term-physics-2026"

    legacy_key = client.post(
        "/api/courses",
        headers=_auth(teacher),
        json={
            "school_id": school_id,
            "course_key": "mathematics",
            "title": "Legacy Mathematics",
        },
    )
    assert legacy_key.status_code == 201, legacy_key.json()
    assert legacy_key.json()["subject_key"] == "mathematics"

    generated_key = client.post(
        "/api/courses",
        headers=_auth(teacher),
        json={"school_id": school_id, "title": "General Studies"},
    )
    assert generated_key.status_code == 201, generated_key.json()
    assert generated_key.json()["subject_key"] == "general"
    assert generated_key.json()["course_key"].startswith("course-")

    homeroom = client.post(
        "/api/classes",
        headers=_auth(teacher),
        json={"school_id": school_id, "name": "Class 1"},
    )
    assert homeroom.status_code == 201, homeroom.json()
    assert homeroom.json()["kind"] == "homeroom"

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        db.add(
            ClassGroup(
                school_id=school_id,
                name="Internal course cohort",
                kind="course_cohort",
                status="active",
            )
        )
        db.commit()

    teacher_classes = client.get(
        "/api/classes",
        headers=_auth(teacher),
        params={"school_id": school_id},
    )
    assert teacher_classes.status_code == 200, teacher_classes.json()
    assert [item["name"] for item in teacher_classes.json()] == ["Class 1"]

    admin_classes = client.get(
        "/api/admin/classes",
        headers=_auth(admin),
        params={"school_id": school_id},
    )
    assert admin_classes.status_code == 200, admin_classes.json()
    assert [item["name"] for item in admin_classes.json()["items"]] == ["Class 1"]

    overview = client.get("/api/admin/stats", headers=_auth(admin))
    assert overview.status_code == 200, overview.json()
    assert overview.json()["total_classes"] == 1


def test_0054_sqlite_roundtrip_backfills_course_subject_and_class_kind(tmp_path, monkeypatch) -> None:
    database_path = tmp_path / "course-taxonomy-roundtrip.db"
    database_url = f"sqlite+pysqlite:///{database_path.as_posix()}"
    backend_root = Path(__file__).resolve().parents[1]
    monkeypatch.setenv("ASTRA_DATABASE_URL", database_url)
    get_settings.cache_clear()
    reset_database_state()
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "alembic"))
    try:
        command.upgrade(config, "20260810_0053")
        engine = create_engine(database_url)
        now = datetime.now(UTC).isoformat()
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO users "
                    "(id, username, normalized_username, display_name, password_hash, role, status, created_at, updated_at) "
                    "VALUES (1, 'legacy_taxonomy_teacher', 'legacy_taxonomy_teacher', 'Legacy Teacher', "
                    "'hash', 'teacher', 'active', :now, :now)"
                ),
                {"now": now},
            )
            connection.execute(
                text(
                    "INSERT INTO schools (id, name, status, version, created_at, updated_at) "
                    "VALUES (1, 'Legacy Taxonomy School', 'active', 1, :now, :now)"
                ),
                {"now": now},
            )
            connection.execute(
                text(
                    "INSERT INTO class_groups "
                    "(id, school_id, name, status, version, created_at, updated_at) "
                    "VALUES (1, 1, 'Legacy Class', 'active', 1, :now, :now)"
                ),
                {"now": now},
            )
            connection.execute(
                text(
                    "INSERT INTO courses "
                    "(id, school_id, creator_user_id, galaxy_key, course_key, title, status, created_at, updated_at) "
                    "VALUES (1, 1, 1, 'englab', 'physics', 'Legacy Physics', 'published', :now, :now)"
                ),
                {"now": now},
            )

        command.upgrade(config, "20260825_0054")
        with engine.connect() as connection:
            assert connection.execute(text("SELECT subject_key FROM courses WHERE id = 1")).scalar_one() == "physics"
            assert connection.execute(text("SELECT kind FROM class_groups WHERE id = 1")).scalar_one() == "homeroom"
        assert "subject_key" in {column["name"] for column in inspect(engine).get_columns("courses")}
        assert "kind" in {column["name"] for column in inspect(engine).get_columns("class_groups")}
        assert "ix_courses_galaxy_subject" in {item["name"] for item in inspect(engine).get_indexes("courses")}
        assert "ix_class_groups_school_kind_status" in {
            item["name"] for item in inspect(engine).get_indexes("class_groups")
        }

        command.downgrade(config, "20260810_0053")
        assert "subject_key" not in {column["name"] for column in inspect(engine).get_columns("courses")}
        assert "kind" not in {column["name"] for column in inspect(engine).get_columns("class_groups")}
    finally:
        reset_database_state()
        get_settings.cache_clear()
