from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from app.core.config import get_settings
from app.db.session import reset_database_state


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Cookie": ""}


def _register_and_login(client, username: str, role: str = "student") -> str:
    password = "Teacher-application-password-123"
    created = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "display_name": username.replace("_", " ").title(),
            "password": password,
            "role": role,
        },
    )
    assert created.status_code == 201, created.json()
    logged_in = client.post("/api/auth/login", json={"username": username, "password": password})
    assert logged_in.status_code == 200, logged_in.json()
    return logged_in.json()["access_token"]


def _bootstrap_admin(client) -> str:
    password = "Teacher-application-admin-123"
    created = client.post(
        "/api/admin/bootstrap",
        json={
            "username": "teacher_application_admin",
            "display_name": "Teacher Application Admin",
            "password": password,
        },
    )
    assert created.status_code == 201, created.json()
    logged_in = client.post(
        "/api/auth/login",
        json={"username": "teacher_application_admin", "password": password},
    )
    assert logged_in.status_code == 200, logged_in.json()
    return logged_in.json()["access_token"]


def test_teacher_application_approval_and_pending_read_only_gate(client) -> None:
    admin = _bootstrap_admin(client)
    legacy_teacher = _register_and_login(client, "application_legacy_teacher", "teacher")
    applicant = _register_and_login(client, "application_student")

    school = client.post(
        "/api/schools",
        headers=_auth(legacy_teacher),
        json={"name": "Teacher Application School"},
    )
    assert school.status_code == 201, school.json()
    classroom = client.post(
        "/api/classes",
        headers=_auth(legacy_teacher),
        json={"school_id": school.json()["id"], "name": "Application Class"},
    )
    assert classroom.status_code == 201, classroom.json()

    no_application = client.get("/api/v1/teacher-applications/me", headers=_auth(applicant))
    assert no_application.status_code == 200
    assert no_application.json() is None

    created = client.post(
        "/api/v1/teacher-applications",
        headers=_auth(applicant),
        json={"message": "  I teach physics.  "},
    )
    assert created.status_code == 201, created.json()
    application_id = created.json()["id"]
    assert created.json()["status"] == "pending"
    assert created.json()["message"] == "I teach physics."
    assert created.json()["applicant_role"] == "student"

    duplicate = client.post(
        "/api/v1/teacher-applications",
        headers=_auth(applicant),
        json={"message": "duplicate"},
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "Teacher application is already pending"

    my_application = client.get("/api/v1/teacher-applications/me", headers=_auth(applicant))
    assert my_application.status_code == 200
    assert my_application.json()["id"] == application_id
    assert my_application.json()["status"] == "pending"

    read_only_course_list = client.get("/api/courses", headers=_auth(applicant))
    assert read_only_course_list.status_code == 200
    blocked_join = client.post(
        f"/api/classes/{classroom.json()['id']}/join-requests",
        headers=_auth(applicant),
        json={"role": "student", "message": "join"},
    )
    assert blocked_join.status_code == 403
    assert blocked_join.json()["detail"] == "Teacher application is pending; account is read-only"
    blocked_progress = client.post(
        "/api/learning-events",
        headers=_auth(applicant),
        json={"event_type": "visit", "course_id": 1, "payload": {}},
    )
    assert blocked_progress.status_code == 403
    assert blocked_progress.json()["detail"] == "Teacher application is pending; account is read-only"

    forbidden_queue = client.get("/api/v1/admin/teacher-applications", headers=_auth(applicant))
    assert forbidden_queue.status_code == 403
    forbidden_review = client.patch(
        f"/api/v1/admin/teacher-applications/{application_id}",
        headers=_auth(legacy_teacher),
        json={"status": "approved"},
    )
    assert forbidden_review.status_code == 403

    queue = client.get(
        "/api/v1/admin/teacher-applications",
        headers=_auth(admin),
        params={"status": "pending", "limit": 20, "offset": 0},
    )
    assert queue.status_code == 200, queue.json()
    assert queue.json()["total"] == 1
    assert queue.json()["items"][0]["id"] == application_id

    approved = client.patch(
        f"/api/v1/admin/teacher-applications/{application_id}",
        headers=_auth(admin),
        json={"status": "approved", "note": "  identity verified  "},
    )
    assert approved.status_code == 200, approved.json()
    assert approved.json()["status"] == "approved"
    assert approved.json()["applicant_role"] == "teacher"
    assert approved.json()["review_note"] == "identity verified"

    promoted = client.get("/api/users/me", headers=_auth(applicant))
    assert promoted.status_code == 200
    assert promoted.json()["role"] == "teacher"
    repeated = client.patch(
        f"/api/v1/admin/teacher-applications/{application_id}",
        headers=_auth(admin),
        json={"status": "approved"},
    )
    assert repeated.status_code == 409
    assert repeated.json()["detail"] == "Teacher application has already been reviewed"


def test_rejected_teacher_applicant_returns_to_student_and_can_reapply(client) -> None:
    admin = _bootstrap_admin(client)
    applicant = _register_and_login(client, "rejected_application_student")

    first = client.post(
        "/api/v1/teacher-applications",
        headers=_auth(applicant),
        json={"message": "first request"},
    )
    assert first.status_code == 201, first.json()
    rejected = client.patch(
        f"/api/v1/admin/teacher-applications/{first.json()['id']}",
        headers=_auth(admin),
        json={"status": "rejected", "note": "More information required"},
    )
    assert rejected.status_code == 200, rejected.json()
    assert rejected.json()["status"] == "rejected"
    assert rejected.json()["applicant_role"] == "student"

    current_user = client.get("/api/users/me", headers=_auth(applicant))
    assert current_user.status_code == 200
    assert current_user.json()["role"] == "student"

    second = client.post(
        "/api/v1/teacher-applications",
        headers=_auth(applicant),
        json={"message": "second request"},
    )
    assert second.status_code == 201, second.json()
    assert second.json()["id"] != first.json()["id"]
    assert second.json()["status"] == "pending"
    latest = client.get("/api/v1/teacher-applications/me", headers=_auth(applicant))
    assert latest.status_code == 200
    assert latest.json()["id"] == second.json()["id"]

    logout = client.post("/api/auth/logout", headers=_auth(applicant))
    assert logout.status_code == 200


def test_formal_teacher_cannot_submit_teacher_application(client) -> None:
    teacher = _register_and_login(client, "already_formal_teacher", "teacher")
    response = client.post(
        "/api/v1/teacher-applications",
        headers=_auth(teacher),
        json={"message": "not needed"},
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Teacher application requires a student account"


def test_0055_sqlite_roundtrip_creates_teacher_application_history(tmp_path, monkeypatch) -> None:
    database_path = tmp_path / "teacher-application-roundtrip.db"
    database_url = f"sqlite+pysqlite:///{database_path.as_posix()}"
    backend_root = Path(__file__).resolve().parents[1]
    monkeypatch.setenv("ASTRA_DATABASE_URL", database_url)
    get_settings.cache_clear()
    reset_database_state()
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "alembic"))
    try:
        command.upgrade(config, "20260825_0054")
        engine = create_engine(database_url)
        assert "teacher_applications" not in set(inspect(engine).get_table_names())

        command.upgrade(config, "20260825_0055")
        assert "teacher_applications" in set(inspect(engine).get_table_names())
        columns = {column["name"] for column in inspect(engine).get_columns("teacher_applications")}
        assert {
            "id",
            "user_id",
            "status",
            "message",
            "reviewed_by_user_id",
            "reviewed_at",
            "review_note",
            "created_at",
            "updated_at",
        } <= columns
        indexes = {item["name"] for item in inspect(engine).get_indexes("teacher_applications")}
        assert "ix_teacher_applications_status_id" in indexes
        assert "ix_teacher_applications_user_id_id" in indexes

        command.downgrade(config, "20260825_0054")
        assert "teacher_applications" not in set(inspect(engine).get_table_names())
    finally:
        reset_database_state()
        get_settings.cache_clear()
