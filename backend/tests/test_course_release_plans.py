from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Barrier, Thread

from alembic import command
from alembic.config import Config
from fastapi import HTTPException
import pytest
from sqlalchemy import create_engine, event, inspect, select, text
from sqlalchemy.dialects import mysql
from sqlalchemy.schema import CreateTable

from app.api.endpoints import code_judge, learning_events, submissions
from app.core.config import get_settings
from app.db.session import get_session_factory, make_engine, reset_database_state
from app.models import (
    ClassGroup,
    Course,
    CourseClass,
    CourseUnit,
    CourseUnitClassPlan,
    School,
)
from app.services import course_release_plans, course_release_write_gate


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Cookie": ""}


def _login(client, username: str, role: str) -> str:
    password = "Plan-test-password-123"
    registered = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "display_name": username,
            "password": password,
            "role": role,
        },
    )
    assert registered.status_code == 201
    logged_in = client.post("/api/auth/login", json={"username": username, "password": password})
    assert logged_in.status_code == 200
    return logged_in.json()["access_token"]


def _school(client, token: str) -> int:
    response = client.post(
        "/api/schools",
        headers=_auth(token),
        json={"name": "Release Plan School", "region": "Shanghai"},
    )
    assert response.status_code == 201, response.json()
    return response.json()["id"]


def _class(client, token: str, school_id: int, name: str) -> int:
    response = client.post(
        "/api/classes",
        headers=_auth(token),
        json={"school_id": school_id, "name": name},
    )
    assert response.status_code == 201
    return response.json()["id"]


def _course(client, token: str, school_id: int) -> int:
    # V7.5.3 remains compatible with pre-key teacher clients.
    response = client.post(
        "/api/courses",
        headers=_auth(token),
        json={"school_id": school_id, "title": "Release Plan Course", "status": "published"},
    )
    assert response.status_code == 201
    assert response.json()["galaxy_key"] == "englab"
    assert response.json()["course_key"].startswith("course-")
    return response.json()["id"]


def _attach(client, token: str, course_id: int, class_id: int) -> None:
    response = client.post(
        f"/api/courses/{course_id}/classes",
        headers=_auth(token),
        json={"class_id": class_id},
    )
    assert response.status_code == 201


def _unit(client, token: str, course_id: int, position: int, key: str | None = None) -> int:
    payload = {"title": f"Unit {position}", "position": position, "status": "published"}
    if key is not None:
        payload["activity_key"] = key
    response = client.post(f"/api/courses/{course_id}/units", headers=_auth(token), json=payload)
    assert response.status_code == 201
    if key is None:
        assert response.json()["activity_key"].startswith("activity-")
    return response.json()["id"]


def test_release_plan_effective_access_and_progress_contract(client):
    teacher = _login(client, "release_plan_teacher", "teacher")
    student = _login(client, "release_plan_student", "student")
    second_student = _login(client, "release_plan_student_2", "student")
    school_id = _school(client, teacher)
    class_id = _class(client, teacher, school_id, "Release Plan Class")
    other_class_id = _class(client, teacher, school_id, "Release Plan Other Class")
    course_id = _course(client, teacher, school_id)
    _attach(client, teacher, course_id, class_id)
    unit_one_id = _unit(client, teacher, course_id, 1, "control-flow.loop-boundary")
    unit_two_id = _unit(client, teacher, course_id, 2, "cosmos.orbital-scale")
    assert client.post(f"/api/classes/{class_id}/join", headers=_auth(student), json={"role": "student"}).status_code == 201
    assert client.post(f"/api/classes/{class_id}/join", headers=_auth(second_student), json={"role": "student"}).status_code == 201

    plan = client.get(f"/api/courses/{course_id}/classes/{class_id}/release-plan", headers=_auth(teacher))
    assert plan.status_code == 200
    assert plan.json()["plan_version"] == 1
    assert {item["activity_key"] for item in plan.json()["items"]} == {
        "control-flow.loop-boundary",
        "cosmos.orbital-scale",
    }

    event = client.post(
        "/api/learning-events",
        headers=_auth(student),
        json={"class_id": class_id, "unit_id": unit_one_id, "event_type": "start"},
    )
    assert event.status_code == 201
    assignment = client.post(
        f"/api/courses/{course_id}/units/{unit_one_id}/assignments",
        headers=_auth(teacher),
        json={"title": "Open assignment"},
    )
    assert assignment.status_code == 201
    submission = client.post(
        f"/api/assignments/{assignment.json()['id']}/submissions",
        headers=_auth(student),
        json={"class_id": class_id, "content": {"answer": "before lock"}},
    )
    assert submission.status_code == 201
    hidden_history_event = client.post(
        "/api/learning-events",
        headers=_auth(student),
        json={"class_id": class_id, "unit_id": unit_two_id, "event_type": "start"},
    )
    assert hidden_history_event.status_code == 201
    hidden_history_assignment = client.post(
        f"/api/courses/{course_id}/units/{unit_two_id}/assignments",
        headers=_auth(teacher),
        json={"title": "Later hidden assignment"},
    )
    assert hidden_history_assignment.status_code == 201
    hidden_history_submission = client.post(
        f"/api/assignments/{hidden_history_assignment.json()['id']}/submissions",
        headers=_auth(student),
        json={"class_id": class_id, "content": {"answer": "must not leak after hide"}},
    )
    assert hidden_history_submission.status_code == 201

    hidden = client.patch(
        f"/api/courses/{course_id}/classes/{class_id}/release-plan",
        headers=_auth(teacher),
        json={
            "expected_version": 1,
            "items": [{"course_unit_id": unit_two_id, "release_mode": "hidden"}],
        },
    )
    assert hidden.status_code == 200
    assert hidden.json()["changed"] is True
    assert hidden.json()["plan_version"] == 2
    units = client.get(f"/api/courses/{course_id}/units?class_id={class_id}", headers=_auth(student))
    assert units.status_code == 200
    assert [item["id"] for item in units.json()] == [unit_one_id]
    assert "cosmos.orbital-scale" not in str(units.json())
    visible_events = client.get(f"/api/learning-events?class_id={class_id}", headers=_auth(student))
    assert visible_events.status_code == 200
    assert visible_events.json()
    assert {item["unit_id"] for item in visible_events.json()} == {unit_one_id}
    assert hidden_history_event.json()["id"] not in {item["id"] for item in visible_events.json()}
    visible_event_page = client.get(
        f"/api/learning-events/page?class_id={class_id}&limit=1&offset=0",
        headers=_auth(student),
    )
    assert visible_event_page.status_code == 200
    assert visible_event_page.json()["total"] == 2
    assert [item["unit_id"] for item in visible_event_page.json()["items"]] == [unit_one_id]
    assert visible_event_page.json()["next_offset"] == 1
    teacher_event_page = client.get(
        f"/api/learning-events/page?class_id={class_id}&limit=1&offset=0",
        headers=_auth(teacher),
    )
    assert teacher_event_page.status_code == 200
    assert teacher_event_page.json()["total"] == 4
    assert teacher_event_page.json()["next_offset"] == 1
    progress = client.get(f"/api/progress/me?class_id={class_id}", headers=_auth(student))
    assert progress.status_code == 200
    assert progress.json()["learning_events"] == len(visible_events.json())
    assert progress.json()["submitted_assignments"] == 1
    assignment_center = client.get(f"/api/assignments/me?class_id={class_id}", headers=_auth(student))
    assert assignment_center.status_code == 200
    assert [item["assignment"]["id"] for item in assignment_center.json()["items"]] == [assignment.json()["id"]]
    hidden_event = client.post(
        "/api/learning-events",
        headers=_auth(student),
        json={"class_id": class_id, "unit_id": unit_two_id, "event_type": "start"},
    )
    assert hidden_event.status_code == 403

    locked = client.patch(
        f"/api/courses/{course_id}/classes/{class_id}/release-plan",
        headers=_auth(teacher),
        json={
            "expected_version": 2,
            "items": [{"course_unit_id": unit_one_id, "release_mode": "locked"}],
        },
    )
    assert locked.status_code == 200
    assert locked.json()["plan_version"] == 3
    locked_unit = client.get(f"/api/courses/{course_id}/units?class_id={class_id}", headers=_auth(student))
    assert locked_unit.status_code == 200
    assert locked_unit.json()[0]["effective_release_state"] == "locked"
    assert locked_unit.json()[0]["lock_reasons"] == ["manual_locked"]
    locked_event = client.post(
        "/api/learning-events",
        headers=_auth(student),
        json={"class_id": class_id, "unit_id": unit_one_id, "event_type": "start"},
    )
    assert locked_event.status_code == 409

    matrix = client.get(
        f"/api/progress/courses/{course_id}/classes/{class_id}/students?limit=1&offset=0",
        headers=_auth(teacher),
    )
    assert matrix.status_code == 200
    assert matrix.json()["total"] == 2
    assert matrix.json()["next_offset"] == 1
    own_block = next(block for block in matrix.json()["items"][0]["blocks"] if block["course_unit_id"] == unit_one_id)
    assert own_block["effective_release_state"] == "locked"
    assert own_block["started"] is True
    assert own_block["submitted"] == 1
    hidden_block = next(block for block in matrix.json()["items"][0]["blocks"] if block["course_unit_id"] == unit_two_id)
    assert hidden_block["effective_release_state"] == "hidden"
    assert hidden_block["started"] is False
    assert hidden_block["submitted"] == 0

    no_op = client.patch(
        f"/api/courses/{course_id}/classes/{class_id}/release-plan",
        headers=_auth(teacher),
        json={"expected_version": 3, "items": [{"course_unit_id": unit_one_id, "release_mode": "locked"}]},
    )
    assert no_op.status_code == 200
    assert no_op.json()["changed"] is False
    assert no_op.json()["plan_version"] == 3
    stale = client.patch(
        f"/api/courses/{course_id}/classes/{class_id}/release-plan",
        headers=_auth(teacher),
        json={"expected_version": 2, "items": [{"course_unit_id": unit_one_id, "release_mode": "open"}]},
    )
    assert stale.status_code == 409

    swap = client.patch(
        f"/api/courses/{course_id}/classes/{class_id}/release-plan",
        headers=_auth(teacher),
        json={
            "expected_version": 3,
            "items": [
                {"course_unit_id": unit_one_id, "position": 2},
                {"course_unit_id": unit_two_id, "position": 1},
            ],
        },
    )
    assert swap.status_code == 200
    assert [item["course_unit_id"] for item in swap.json()["items"]] == [unit_two_id, unit_one_id]

    _attach(client, teacher, course_id, other_class_id)
    assert client.post(f"/api/classes/{other_class_id}/join", headers=_auth(student), json={"role": "student"}).status_code == 201
    ambiguous = client.get(f"/api/courses/{course_id}/units", headers=_auth(student))
    assert ambiguous.status_code == 422


def test_release_plan_key_validation_allows_segmented_activity_keys(client):
    teacher = _login(client, "release_key_teacher", "teacher")
    school_id = _school(client, teacher)
    course = client.post(
        "/api/courses",
        headers=_auth(teacher),
        json={
            "school_id": school_id,
            "galaxy_key": "Astra_Core",
            "course_key": "orbital-path",
            "title": "Key contract",
            "status": "published",
        },
    )
    assert course.status_code == 201
    assert course.json()["galaxy_key"] == "astra-core"
    unit = client.post(
        f"/api/courses/{course.json()['id']}/units",
        headers=_auth(teacher),
        json={"title": "Segmented", "position": 1, "activity_key": "Control_Flow.loop-boundary"},
    )
    assert unit.status_code == 201
    assert unit.json()["activity_key"] == "control-flow.loop-boundary"
    invalid = client.post(
        f"/api/courses/{course.json()['id']}/units",
        headers=_auth(teacher),
        json={"title": "Invalid", "position": 2, "activity_key": "control..flow"},
    )
    assert invalid.status_code == 422


def test_release_plan_read_rejects_missing_rows_without_get_repair(client):
    teacher = _login(client, "release_inconsistent_teacher", "teacher")
    school_id = _school(client, teacher)
    class_id = _class(client, teacher, school_id, "Release Inconsistent Class")
    course_id = _course(client, teacher, school_id)
    _attach(client, teacher, course_id, class_id)
    unit_id = _unit(client, teacher, course_id, 1)
    with get_session_factory(get_settings().database_url)() as db:
        plan = db.scalar(
            text(
                "SELECT id FROM course_unit_class_plans "
                "WHERE course_unit_id = :unit_id"
            ),
            {"unit_id": unit_id},
        )
        assert plan is not None
        db.execute(text("DELETE FROM course_unit_class_plans WHERE id = :plan_id"), {"plan_id": plan})
        db.commit()
    response = client.get(f"/api/courses/{course_id}/classes/{class_id}/release-plan", headers=_auth(teacher))
    assert response.status_code == 409
    with get_session_factory(get_settings().database_url)() as db:
        remaining = db.scalar(text("SELECT COUNT(*) FROM course_unit_class_plans WHERE course_unit_id = :unit_id"), {"unit_id": unit_id})
        assert remaining == 0


def test_student_unit_list_query_count_is_constant_per_block_count(client):
    teacher = _login(client, "release_query_teacher", "teacher")
    student = _login(client, "release_query_student", "student")
    school_id = _school(client, teacher)
    class_id = _class(client, teacher, school_id, "Release Query Class")
    course_id = _course(client, teacher, school_id)
    _attach(client, teacher, course_id, class_id)
    for position in range(1, 26):
        _unit(client, teacher, course_id, position)
    assert client.post(f"/api/classes/{class_id}/join", headers=_auth(student), json={"role": "student"}).status_code == 201

    statements: list[str] = []
    engine = make_engine(get_settings().database_url)

    def capture_statement(_connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture_statement)
    try:
        response = client.get(f"/api/courses/{course_id}/units?class_id={class_id}", headers=_auth(student))
    finally:
        event.remove(engine, "before_cursor_execute", capture_statement)
    assert response.status_code == 200
    assert len(response.json()) == 25
    assert len(statements) <= 20


def test_learning_event_page_uses_limited_database_query(client):
    teacher = _login(client, "release_event_page_teacher", "teacher")
    student = _login(client, "release_event_page_student", "student")
    school_id = _school(client, teacher)
    class_id = _class(client, teacher, school_id, "Release Event Page Class")
    course_id = _course(client, teacher, school_id)
    _attach(client, teacher, course_id, class_id)
    unit_id = _unit(client, teacher, course_id, 1)
    assert client.post(f"/api/classes/{class_id}/join", headers=_auth(student), json={"role": "student"}).status_code == 201
    for event_type in ("visit", "start", "submit"):
        response = client.post(
            "/api/learning-events",
            headers=_auth(student),
            json={"class_id": class_id, "unit_id": unit_id, "event_type": event_type},
        )
        assert response.status_code == 201

    statements: list[str] = []
    engine = make_engine(get_settings().database_url)

    def capture_statement(_connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture_statement)
    try:
        page = client.get(
            f"/api/learning-events/page?class_id={class_id}&limit=2&offset=0",
            headers=_auth(student),
        )
    finally:
        event.remove(engine, "before_cursor_execute", capture_statement)
    assert page.status_code == 200
    assert page.json()["total"] == 3
    assert len(page.json()["items"]) == 2
    assert page.json()["next_offset"] == 2
    assert any("LIMIT" in statement.upper() for statement in statements)
    assert len(statements) <= 8


@pytest.mark.parametrize(
    ("release_change", "expected_total"),
    [
        ("school_inactive", 0),
        ("class_inactive", 0),
        ("course_class_inactive", 0),
        ("missing_plan", 0),
        ("hidden", 0),
        ("locked", 1),
    ],
)
def test_learning_event_page_count_matches_student_release_visibility(client, release_change, expected_total):
    teacher = _login(client, f"release_page_visibility_teacher_{release_change}", "teacher")
    student = _login(client, f"release_page_visibility_student_{release_change}", "student")
    school_id = _school(client, teacher)
    class_id = _class(client, teacher, school_id, f"Release Page Visibility {release_change}")
    course_id = _course(client, teacher, school_id)
    _attach(client, teacher, course_id, class_id)
    unit_id = _unit(client, teacher, course_id, 1)
    assert client.post(f"/api/classes/{class_id}/join", headers=_auth(student), json={"role": "student"}).status_code == 201
    created = client.post(
        "/api/learning-events",
        headers=_auth(student),
        json={"class_id": class_id, "unit_id": unit_id, "event_type": "start"},
    )
    assert created.status_code == 201

    if release_change in {"hidden", "locked"}:
        changed = client.patch(
            f"/api/courses/{course_id}/classes/{class_id}/release-plan",
            headers=_auth(teacher),
            json={"expected_version": 1, "items": [{"course_unit_id": unit_id, "release_mode": release_change}]},
        )
        assert changed.status_code == 200
    else:
        with get_session_factory(get_settings().database_url)() as db:
            if release_change == "school_inactive":
                school = db.get(School, school_id)
                assert school is not None
                school.status = "inactive"
            elif release_change == "class_inactive":
                class_group = db.get(ClassGroup, class_id)
                assert class_group is not None
                class_group.status = "inactive"
            else:
                course_class = db.scalar(
                    select(CourseClass).where(CourseClass.course_id == course_id, CourseClass.class_id == class_id)
                )
                assert course_class is not None
                if release_change == "course_class_inactive":
                    course_class.status = "inactive"
                else:
                    plan = db.scalar(
                        select(CourseUnitClassPlan).where(
                            CourseUnitClassPlan.course_class_id == course_class.id,
                            CourseUnitClassPlan.course_unit_id == unit_id,
                        )
                    )
                    assert plan is not None
                    db.delete(plan)
            db.commit()

    page = client.get("/api/learning-events/page?limit=10&offset=0", headers=_auth(student))
    assert page.status_code == 200
    assert page.json()["total"] == expected_total
    assert len(page.json()["items"]) == expected_total
    assert page.json()["next_offset"] is None

    legacy_expected = 0 if release_change in {"missing_plan", "hidden"} else 1
    compatibility_page = client.get(
        "/api/learning-events/page?include_inactive_locked=true&limit=10&offset=0",
        headers=_auth(student),
    )
    assert compatibility_page.status_code == 200
    assert compatibility_page.json()["total"] == legacy_expected
    assert len(compatibility_page.json()["items"]) == legacy_expected
    assert compatibility_page.json()["next_offset"] is None

    legacy = client.get("/api/learning-events", headers=_auth(student))
    assert legacy.status_code == 200
    assert len(legacy.json()) == legacy_expected


@pytest.mark.parametrize(
    ("release_mode", "expected_status"),
    [("hidden", 403), ("locked", 409)],
)
def test_student_write_access_rechecks_release_after_barrier(client, monkeypatch, release_mode, expected_status):
    teacher = _login(client, f"release_barrier_teacher_{release_mode}", "teacher")
    student = _login(client, f"release_barrier_student_{release_mode}", "student")
    school_id = _school(client, teacher)
    class_id = _class(client, teacher, school_id, f"Barrier {release_mode} Class")
    course_id = _course(client, teacher, school_id)
    _attach(client, teacher, course_id, class_id)
    unit_id = _unit(client, teacher, course_id, 1)
    assert client.post(f"/api/classes/{class_id}/join", headers=_auth(student), json={"role": "student"}).status_code == 201

    barrier = Barrier(2, timeout=5)
    original_lock = course_release_write_gate.lock_active_class_for_write

    def pause_before_student_write_lock(
        db,
        locked_class_id,
        **lock_options,
    ):
        barrier.wait()
        barrier.wait()
        return original_lock(db, locked_class_id, **lock_options)

    monkeypatch.setattr(
        course_release_write_gate,
        "lock_active_class_for_write",
        pause_before_student_write_lock,
    )
    outcome: dict[str, int] = {}
    session_factory = get_session_factory(get_settings().database_url)

    def student_write() -> None:
        with session_factory() as db:
            course = db.get(Course, course_id)
            class_group = db.get(ClassGroup, class_id)
            unit = db.get(CourseUnit, unit_id)
            student_user = db.scalar(text("SELECT id FROM users WHERE username = :username"), {"username": f"release_barrier_student_{release_mode}"})
            assert course is not None and class_group is not None and unit is not None and student_user is not None
            try:
                course_release_write_gate.require_student_unit_open_for_write(
                    db,
                    course=course,
                    class_group=class_group,
                    unit=unit,
                    student_id=int(student_user),
                )
            except HTTPException as exc:
                outcome["status"] = exc.status_code
                db.rollback()
            else:
                outcome["status"] = 201
                db.rollback()

    def teacher_release_change() -> None:
        barrier.wait()
        with session_factory() as db:
            course_class = db.scalar(
                text("SELECT id FROM course_classes WHERE course_id = :course_id AND class_id = :class_id"),
                {"course_id": course_id, "class_id": class_id},
            )
            assert course_class is not None
            db.execute(
                text(
                    "UPDATE course_unit_class_plans SET release_mode = :release_mode "
                    "WHERE course_class_id = :course_class_id AND course_unit_id = :unit_id"
                ),
                {"release_mode": release_mode, "course_class_id": int(course_class), "unit_id": unit_id},
            )
            db.commit()
        barrier.wait()

    teacher_thread = Thread(target=teacher_release_change)
    student_thread = Thread(target=student_write)
    teacher_thread.start()
    student_thread.start()
    teacher_thread.join(timeout=10)
    student_thread.join(timeout=10)
    assert not teacher_thread.is_alive()
    assert not student_thread.is_alive()
    assert outcome == {"status": expected_status}


def _post_student_write_after_release_barrier(
    client,
    monkeypatch,
    *,
    module,
    teacher_headers,
    course_id: int,
    class_id: int,
    unit_id: int,
    student_headers,
    write_url: str,
    write_payload: dict,
    release_mode: str,
):
    barrier = Barrier(2, timeout=5)
    original_gate = module.require_student_unit_open_for_write

    def pause_after_open_preflight(db, *, course, class_group, unit, student_id):
        course_class = db.scalar(
            text("SELECT id FROM course_classes WHERE course_id = :course_id AND class_id = :class_id"),
            {"course_id": course.id, "class_id": class_group.id},
        )
        plan_mode = db.scalar(
            text(
                "SELECT release_mode FROM course_unit_class_plans "
                "WHERE course_class_id = :course_class_id AND course_unit_id = :unit_id"
            ),
            {"course_class_id": int(course_class), "unit_id": unit.id},
        )
        assert plan_mode == "open"
        barrier.wait()
        barrier.wait()
        return original_gate(
            db,
            course=course,
            class_group=class_group,
            unit=unit,
            student_id=student_id,
        )

    monkeypatch.setattr(module, "require_student_unit_open_for_write", pause_after_open_preflight)
    outcome: dict[str, object] = {}

    def student_write() -> None:
        try:
            outcome["response"] = client.post(write_url, headers=student_headers, json=write_payload)
        except BaseException as exc:  # pragma: no cover - asserted below
            outcome["error"] = exc

    worker = Thread(target=student_write)
    worker.start()
    barrier.wait()
    release = client.patch(
        f"/api/courses/{course_id}/classes/{class_id}/release-plan",
        headers=teacher_headers,
        json={
            "expected_version": 1,
            "items": [{"course_unit_id": unit_id, "release_mode": release_mode}],
        },
    )
    assert release.status_code == 200, release.json()
    barrier.wait()
    worker.join(timeout=10)
    assert not worker.is_alive()
    assert "error" not in outcome
    response = outcome.get("response")
    assert response is not None
    return response


@pytest.mark.parametrize(("release_mode", "expected_status"), [("hidden", 403), ("locked", 409)])
def test_learning_event_http_write_rechecks_release_after_barrier(client, monkeypatch, release_mode, expected_status):
    teacher = _login(client, f"event_barrier_teacher_{release_mode}", "teacher")
    student = _login(client, f"event_barrier_student_{release_mode}", "student")
    school_id = _school(client, teacher)
    class_id = _class(client, teacher, school_id, f"Event barrier {release_mode}")
    course_id = _course(client, teacher, school_id)
    _attach(client, teacher, course_id, class_id)
    unit_id = _unit(client, teacher, course_id, 1)
    assert client.post(f"/api/classes/{class_id}/join", headers=_auth(student), json={"role": "student"}).status_code == 201

    response = _post_student_write_after_release_barrier(
        client,
        monkeypatch,
        module=learning_events,
        teacher_headers=_auth(teacher),
        course_id=course_id,
        class_id=class_id,
        unit_id=unit_id,
        student_headers=_auth(student),
        write_url="/api/learning-events",
        write_payload={"class_id": class_id, "unit_id": unit_id, "event_type": "start"},
        release_mode=release_mode,
    )
    assert response.status_code == expected_status
    with get_session_factory(get_settings().database_url)() as db:
        assert db.scalar(text("SELECT COUNT(*) FROM learning_events WHERE class_id = :class_id AND unit_id = :unit_id"), {"class_id": class_id, "unit_id": unit_id}) == 0


@pytest.mark.parametrize(("release_mode", "expected_status"), [("hidden", 403), ("locked", 409)])
def test_assignment_submission_http_write_rechecks_release_after_barrier(client, monkeypatch, release_mode, expected_status):
    teacher = _login(client, f"assignment_barrier_teacher_{release_mode}", "teacher")
    student = _login(client, f"assignment_barrier_student_{release_mode}", "student")
    school_id = _school(client, teacher)
    class_id = _class(client, teacher, school_id, f"Assignment barrier {release_mode}")
    course_id = _course(client, teacher, school_id)
    _attach(client, teacher, course_id, class_id)
    unit_id = _unit(client, teacher, course_id, 1)
    assignment = client.post(
        f"/api/courses/{course_id}/units/{unit_id}/assignments",
        headers=_auth(teacher),
        json={"title": "Barrier assignment"},
    )
    assert assignment.status_code == 201
    assert client.post(f"/api/classes/{class_id}/join", headers=_auth(student), json={"role": "student"}).status_code == 201

    response = _post_student_write_after_release_barrier(
        client,
        monkeypatch,
        module=submissions,
        teacher_headers=_auth(teacher),
        course_id=course_id,
        class_id=class_id,
        unit_id=unit_id,
        student_headers=_auth(student),
        write_url=f"/api/assignments/{assignment.json()['id']}/submissions",
        write_payload={"class_id": class_id, "content": {"answer": "must not persist"}},
        release_mode=release_mode,
    )
    assert response.status_code == expected_status
    with get_session_factory(get_settings().database_url)() as db:
        assert db.scalar(text("SELECT COUNT(*) FROM submissions WHERE assignment_id = :assignment_id"), {"assignment_id": assignment.json()["id"]}) == 0


@pytest.mark.parametrize(("release_mode", "expected_status"), [("hidden", 403), ("locked", 409)])
def test_code_submission_http_write_rechecks_release_after_barrier(client, monkeypatch, release_mode, expected_status):
    teacher = _login(client, f"code_barrier_teacher_{release_mode}", "teacher")
    student = _login(client, f"code_barrier_student_{release_mode}", "student")
    school_id = _school(client, teacher)
    class_id = _class(client, teacher, school_id, f"Code barrier {release_mode}")
    course_id = _course(client, teacher, school_id)
    _attach(client, teacher, course_id, class_id)
    unit_id = _unit(client, teacher, course_id, 1)
    problem = client.post(
        "/api/code-problems",
        headers=_auth(teacher),
        json={
            "course_id": course_id,
            "course_unit_id": unit_id,
            "title": "Barrier code problem",
            "statement_markdown": "Print one.",
            "test_cases": [{"stdin": "", "expected_stdout": "1\n"}],
        },
    )
    assert problem.status_code == 201, problem.json()
    assert client.post(f"/api/classes/{class_id}/join", headers=_auth(student), json={"role": "student"}).status_code == 201

    response = _post_student_write_after_release_barrier(
        client,
        monkeypatch,
        module=code_judge,
        teacher_headers=_auth(teacher),
        course_id=course_id,
        class_id=class_id,
        unit_id=unit_id,
        student_headers=_auth(student),
        write_url=f"/api/code-problems/{problem.json()['id']}/submissions",
        write_payload={"class_id": class_id, "language": "python", "source_code": "print(1)", "stdin": ""},
        release_mode=release_mode,
    )
    assert response.status_code == expected_status
    with get_session_factory(get_settings().database_url)() as db:
        assert db.scalar(text("SELECT COUNT(*) FROM code_submissions WHERE problem_id = :problem_id"), {"problem_id": problem.json()["id"]}) == 0


def test_0048_sqlite_roundtrip_backfills_id_keys_and_default_open_plans(tmp_path, monkeypatch):
    database_path = tmp_path / "course-release-plan-roundtrip.db"
    database_url = f"sqlite+pysqlite:///{database_path.as_posix()}"
    backend_root = Path(__file__).resolve().parents[1]
    monkeypatch.setenv("ASTRA_DATABASE_URL", database_url)
    get_settings.cache_clear()
    reset_database_state()
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "alembic"))
    try:
        command.upgrade(config, "20260716_0047")
        engine = create_engine(database_url)
        now = datetime.now(UTC).isoformat()
        with engine.begin() as connection:
            connection.execute(text("INSERT INTO users (id, username, normalized_username, display_name, password_hash, role, status, created_at, updated_at) VALUES (1, 'legacy_teacher', 'legacy_teacher', 'Legacy teacher', 'hash', 'teacher', 'active', :now, :now)"), {"now": now})
            connection.execute(text("INSERT INTO schools (id, name, status, version, created_at, updated_at) VALUES (1, 'Legacy School', 'active', 1, :now, :now)"), {"now": now})
            connection.execute(text("INSERT INTO class_groups (id, school_id, name, status, version, created_at, updated_at) VALUES (1, 1, 'Legacy Class', 'active', 1, :now, :now)"), {"now": now})
            connection.execute(text("INSERT INTO courses (id, school_id, creator_user_id, title, status, created_at, updated_at) VALUES (1, 1, 1, 'Mutable legacy title', 'published', :now, :now)"), {"now": now})
            connection.execute(text("INSERT INTO course_units (id, course_id, title, position, content_slug, status, created_at, updated_at) VALUES (1, 1, 'Mutable unit title', 1, 'mutable/slug', 'published', :now, :now)"), {"now": now})
            connection.execute(text("INSERT INTO course_classes (id, course_id, class_id, status, created_at, updated_at) VALUES (1, 1, 1, 'active', :now, :now)"), {"now": now})
        command.upgrade(config, "20260719_0048")
        with engine.connect() as connection:
            assert connection.execute(text("SELECT galaxy_key, course_key FROM courses WHERE id = 1")).one() == ("englab", "legacy-course-1")
            assert connection.execute(text("SELECT activity_key FROM course_units WHERE id = 1")).scalar_one() == "legacy-unit-1"
            assert connection.execute(text("SELECT release_mode, position FROM course_unit_class_plans")).one() == ("open", 1)
        command.downgrade(config, "20260716_0047")
        names = set(inspect(engine).get_table_names())
        assert "course_unit_class_plans" not in names
        assert "activity_key" not in {column["name"] for column in inspect(engine).get_columns("course_units")}
    finally:
        reset_database_state()
        get_settings.cache_clear()


def test_release_plan_schema_compiles_for_mysql() -> None:
    ddl = str(CreateTable(CourseUnitClassPlan.__table__).compile(dialect=mysql.dialect()))
    assert "course_unit_class_plans" in ddl
    assert "release_mode" in ddl
    assert "position > 0" in ddl
    assert "VARCHAR(16)" in ddl
