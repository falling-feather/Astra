from concurrent.futures import ThreadPoolExecutor
from inspect import getsource
from threading import Barrier, Event

from fastapi import HTTPException
from sqlalchemy import func, select

from app.api.endpoints import admin_users as admin_users_endpoint
from app.core.config import get_settings
from app.db.session import get_session_factory
from app.models import AuditLog, Course, User
from app.schemas.course_status import CourseStatusPatch
from app.services import course_status as course_status_service
from app.services.security_control_locks import ADMIN_AUTHORITY_LOCK


def test_course_status_keeps_canonical_authority_and_organization_lock_order():
    source = getsource(course_status_service._update_course_status_locked)
    authority_index = source.index(
        "acquire_security_control_lock(db, ADMIN_AUTHORITY_LOCK)"
    )
    course_index = source.index("course = lock_course_for_write(db, course_id)")
    actor_index = source.index("actor = lock_active_admin(db, actor.id)")
    assert authority_index < course_index < actor_index


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Cookie": ""}


def _login(client, username: str, role: str) -> dict:
    password = "course-status-test-password-123"
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
    logged_in = client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    assert logged_in.status_code == 200, logged_in.json()
    token = logged_in.json()["access_token"]
    me = client.get("/api/users/me", headers=_auth(token))
    assert me.status_code == 200, me.json()
    return {"id": me.json()["id"], "token": token}


def _bootstrap_admin(client, username: str) -> dict:
    password = "course-status-test-password-123"
    created = client.post(
        "/api/admin/bootstrap",
        json={
            "username": username,
            "display_name": username,
            "password": password,
        },
    )
    assert created.status_code == 201, created.json()
    logged_in = client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    assert logged_in.status_code == 200, logged_in.json()
    token = logged_in.json()["access_token"]
    me = client.get("/api/users/me", headers=_auth(token))
    assert me.status_code == 200, me.json()
    return {"id": me.json()["id"], "token": token}


def _course_scope(client, slug: str) -> dict:
    admin = _bootstrap_admin(client, f"course_status_admin_{slug}")
    teacher = _login(client, f"course_status_teacher_{slug}", "teacher")
    school = client.post(
        "/api/schools",
        headers=_auth(teacher["token"]),
        json={"name": f"Course Status School {slug}"},
    )
    assert school.status_code == 201, school.json()
    course = client.post(
        "/api/courses",
        headers=_auth(teacher["token"]),
        json={
            "school_id": school.json()["id"],
            "galaxy_key": "englab",
            "course_key": f"course-status-{slug}",
            "title": f"Course Status {slug}",
            "status": "draft",
        },
    )
    assert course.status_code == 201, course.json()
    return {
        "admin": admin,
        "teacher": teacher,
        "school_id": school.json()["id"],
        "course_id": course.json()["id"],
    }


def test_concurrent_course_status_cas_returns_one_success_and_one_conflict(client):
    scope = _course_scope(client, "concurrent")
    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        actor = db.get(User, scope["admin"]["id"])
        assert actor is not None
        db.expunge(actor)
    command = CourseStatusPatch(
        expected_status="draft",
        status="published",
        reason="Publish the single authoritative concurrent winner.",
    )
    barrier = Barrier(2)

    def publish() -> int:
        barrier.wait(timeout=5)
        with session_factory() as db:
            try:
                course_status_service.update_course_status(
                    db,
                    actor=actor,
                    course_id=scope["course_id"],
                    payload=command,
                )
            except HTTPException as exc:
                db.rollback()
                return exc.status_code
        return 200

    with ThreadPoolExecutor(max_workers=2) as pool:
        status_codes = [
            future.result(timeout=10)
            for future in (pool.submit(publish), pool.submit(publish))
        ]

    assert sorted(status_codes) == [200, 409]
    assert 500 not in status_codes
    with session_factory() as db:
        course = db.get(Course, scope["course_id"])
        assert course is not None
        assert course.status == "published"
        audit_count = int(
            db.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(
                    AuditLog.action == "course.status.patch",
                    AuditLog.resource_id == str(scope["course_id"]),
                )
            )
            or 0
        )
        assert audit_count == 1


def test_course_status_revalidates_admin_after_authority_lock_wait(
    client,
    monkeypatch,
):
    scope = _course_scope(client, "revoked")
    governor_candidate = _login(
        client,
        "course_status_governor_revoked",
        "teacher",
    )
    promoted = client.patch(
        f"/api/admin/users/{governor_candidate['id']}",
        headers=_auth(scope["admin"]["token"]),
        json={"role": "admin"},
    )
    assert promoted.status_code == 200, promoted.json()
    assert promoted.json()["role"] == "admin"
    governor_login = client.post(
        "/api/auth/login",
        json={
            "username": "course_status_governor_revoked",
            "password": "course-status-test-password-123",
        },
    )
    assert governor_login.status_code == 200, governor_login.json()
    governor_token = governor_login.json()["access_token"]

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        stale_actor = db.get(User, scope["admin"]["id"])
        assert stale_actor is not None
        db.expunge(stale_actor)

    authority_lock_requested = Event()
    allow_authority_lock = Event()
    writer_authority_lock_acquired = Event()
    stale_authority_lock_acquired = Event()
    original_acquire = course_status_service.acquire_security_control_lock
    assert original_acquire is admin_users_endpoint.acquire_security_control_lock

    def pause_before_authority_lock(db, name):
        assert name == ADMIN_AUTHORITY_LOCK
        authority_lock_requested.set()
        assert allow_authority_lock.wait(timeout=5)
        result = original_acquire(db, name)
        stale_authority_lock_acquired.set()
        return result

    def observe_writer_authority_lock(db, name):
        assert name == ADMIN_AUTHORITY_LOCK
        result = original_acquire(db, name)
        writer_authority_lock_acquired.set()
        return result

    monkeypatch.setattr(
        course_status_service,
        "acquire_security_control_lock",
        pause_before_authority_lock,
    )
    monkeypatch.setattr(
        admin_users_endpoint,
        "acquire_security_control_lock",
        observe_writer_authority_lock,
    )
    command = CourseStatusPatch(
        expected_status="draft",
        status="published",
        reason="This stale actor must not commit after revocation.",
    )

    def attempt_status_change() -> int:
        with session_factory() as db:
            try:
                course_status_service.update_course_status(
                    db,
                    actor=stale_actor,
                    course_id=scope["course_id"],
                    payload=command,
                )
            except HTTPException as exc:
                db.rollback()
                return exc.status_code
        return 200

    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(attempt_status_change)
        assert authority_lock_requested.wait(timeout=5)
        revoked = client.patch(
            f"/api/admin/users/{scope['admin']['id']}",
            headers=_auth(governor_token),
            json={"status": "disabled"},
        )
        assert writer_authority_lock_acquired.is_set()
        assert revoked.status_code == 200, revoked.json()
        assert revoked.json()["status"] == "disabled"
        allow_authority_lock.set()
        assert future.result(timeout=10) == 403
        assert stale_authority_lock_acquired.is_set()

    with session_factory() as db:
        course = db.get(Course, scope["course_id"])
        assert course is not None
        assert course.status == "draft"
        audit_count = int(
            db.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(
                    AuditLog.action == "course.status.patch",
                    AuditLog.resource_id == str(scope["course_id"]),
                )
            )
            or 0
        )
        assert audit_count == 0
