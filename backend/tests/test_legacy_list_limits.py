from inspect import getsource

import pytest
from fastapi import HTTPException

from app.api.endpoints import classes, code_judge, learning_events
from app.services import submissions_queries
from app.core.config import get_settings
from app.db.session import get_session_factory
from app.models import ClassMembership, CodeJudgeAttempt, LearningEvent, Submission, User
from app.models.base import utc_now
from app.services.pagination import (
    LEGACY_LIST_MAX_ITEMS,
    LEGACY_LIST_PROBE_ITEMS,
    list_legacy_rows,
    list_legacy_scalars,
    paged_endpoint_url,
)


class _ProbeStatement:
    def __init__(self) -> None:
        self.limit_value: int | None = None

    def limit(self, value: int):
        self.limit_value = value
        return self


class _ProbeResult:
    def __init__(self, items: list[object]) -> None:
        self._items = items

    def all(self) -> list[object]:
        return self._items


class _ProbeSession:
    def __init__(self, items: list[object]) -> None:
        self._items = items

    def scalars(self, statement: _ProbeStatement) -> _ProbeResult:
        assert statement.limit_value == LEGACY_LIST_PROBE_ITEMS
        return _ProbeResult(self._items)

    def execute(self, statement: _ProbeStatement) -> _ProbeResult:
        assert statement.limit_value == LEGACY_LIST_PROBE_ITEMS
        return _ProbeResult(self._items)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Cookie": ""}


def _register_and_login(client, username: str, role: str) -> dict[str, int | str]:
    password = "Legacy-limit-password-123"
    registered = client.post(
        "/api/auth/register",
        json={"username": username, "display_name": username, "password": password, "role": role},
    )
    assert registered.status_code == 201, registered.json()
    logged_in = client.post("/api/auth/login", json={"username": username, "password": password})
    assert logged_in.status_code == 200
    token = logged_in.json()["access_token"]
    me = client.get("/api/users/me", headers=_auth(token))
    assert me.status_code == 200
    return {"id": me.json()["id"], "token": token}


def _create_learning_scope(client, teacher_token: str, prefix: str) -> tuple[int, int, int, int]:
    school = client.post(
        "/api/schools",
        headers=_auth(teacher_token),
        json={"name": f"{prefix} School"},
    )
    assert school.status_code == 201, school.json()
    school_id = school.json()["id"]
    class_group = client.post(
        "/api/classes",
        headers=_auth(teacher_token),
        json={"school_id": school_id, "name": f"{prefix} Class"},
    )
    assert class_group.status_code == 201, class_group.json()
    class_id = class_group.json()["id"]
    course = client.post(
        "/api/courses",
        headers=_auth(teacher_token),
        json={"school_id": school_id, "title": f"{prefix} Course", "status": "published"},
    )
    assert course.status_code == 201, course.json()
    course_id = course.json()["id"]
    attached = client.post(
        f"/api/courses/{course_id}/classes",
        headers=_auth(teacher_token),
        json={"class_id": class_id},
    )
    assert attached.status_code == 201, attached.json()
    unit = client.post(
        f"/api/courses/{course_id}/units",
        headers=_auth(teacher_token),
        json={
            "title": f"{prefix} Unit",
            "position": 1,
            "status": "published",
            "activity_key": f"{prefix.lower().replace(' ', '-')}.activity",
        },
    )
    assert unit.status_code == 201, unit.json()
    return school_id, class_id, course_id, unit.json()["id"]


def _student_users(prefix: str) -> list[User]:
    return [
        User(
            username=f"{prefix}_{index:03d}",
            normalized_username=f"{prefix}_{index:03d}",
            display_name=f"{prefix} {index:03d}",
            password_hash="not-used-in-limit-tests",
            role="student",
            status="active",
        )
        for index in range(LEGACY_LIST_PROBE_ITEMS)
    ]


@pytest.mark.parametrize("loader", [list_legacy_scalars, list_legacy_rows])
def test_legacy_list_helper_preserves_small_array_responses(loader):
    items = [object() for _ in range(LEGACY_LIST_MAX_ITEMS)]
    statement = _ProbeStatement()

    assert loader(_ProbeSession(items), statement, paged_endpoint="/api/items/page") == items
    assert statement.limit_value == LEGACY_LIST_PROBE_ITEMS


@pytest.mark.parametrize("loader", [list_legacy_scalars, list_legacy_rows])
def test_legacy_list_helper_rejects_overflow_with_paged_route(loader):
    items = [object() for _ in range(LEGACY_LIST_PROBE_ITEMS)]

    with pytest.raises(HTTPException) as exc_info:
        loader(_ProbeSession(items), _ProbeStatement(), paged_endpoint="/api/items/page")

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == {
        "code": "legacy_list_limit_exceeded",
        "message": "This deprecated array response exceeds its compatibility limit; use the paged endpoint.",
        "max_items": LEGACY_LIST_MAX_ITEMS,
        "paged_endpoint": "/api/items/page",
    }


def test_paged_endpoint_url_preserves_and_encodes_legacy_filters():
    assert paged_endpoint_url(
        "/api/classes/7/members/page",
        role="student assistant",
        status="active",
        omitted=None,
        limit=200,
        offset=0,
    ) == "/api/classes/7/members/page?role=student+assistant&status=active&limit=200&offset=0"


@pytest.mark.parametrize(
    ("handler", "helper_name", "paged_route_token"),
    [
        (learning_events.list_learning_events, "list_legacy_scalars", "/api/learning-events/page"),
        (submissions_queries.list_assignment_submissions, "list_legacy_scalars", "/submissions/page"),
        (classes.list_class_members, "list_legacy_rows", "/members/page"),
        (code_judge.list_code_judge_attempts, "list_legacy_scalars", "/attempts/page"),
    ],
)
def test_deprecated_high_cardinality_handlers_delegate_to_bounded_helpers(
    handler,
    helper_name: str,
    paged_route_token: str,
):
    source = getsource(handler)
    assert helper_name in source
    assert paged_route_token in source
    assert ".all()" not in source


def test_deprecated_learning_event_array_fails_loudly_above_limit_while_page_remains_available(client):
    username = "legacy_event_limit_admin"
    password = "Legacy-event-limit-password-123"
    bootstrapped = client.post(
        "/api/admin/bootstrap",
        json={"username": username, "password": password, "display_name": "Legacy Event Limit Admin"},
    )
    assert bootstrapped.status_code == 201
    logged_in = client.post("/api/auth/login", json={"username": username, "password": password})
    assert logged_in.status_code == 200
    headers = {"Authorization": f"Bearer {logged_in.json()['access_token']}", "Cookie": ""}
    me = client.get("/api/users/me", headers=headers)
    assert me.status_code == 200
    school_id, class_id, _, _ = _create_learning_scope(
        client,
        logged_in.json()["access_token"],
        "Legacy Event Limit",
    )

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        db.add_all(
            LearningEvent(
                user_id=me.json()["id"],
                school_id=school_id,
                class_id=class_id,
                event_type="view",
                payload={"sequence": index},
                occurred_at=utc_now(),
            )
            for index in range(LEGACY_LIST_PROBE_ITEMS)
        )
        db.commit()

    filters = f"class_id={class_id}&user_id={me.json()['id']}"
    legacy = client.get(f"/api/learning-events?{filters}", headers=headers)
    assert legacy.status_code == 409
    assert legacy.json()["detail"]["code"] == "legacy_list_limit_exceeded"
    assert legacy.json()["detail"]["paged_endpoint"] == (
        f"/api/learning-events/page?class_id={class_id}&user_id={me.json()['id']}&limit=200&offset=0"
    )

    page = client.get(f"/api/learning-events/page?{filters}&limit=200&offset=0", headers=headers)
    assert page.status_code == 200
    assert page.json()["total"] == LEGACY_LIST_PROBE_ITEMS
    assert len(page.json()["items"]) == LEGACY_LIST_MAX_ITEMS
    assert page.json()["next_offset"] == LEGACY_LIST_MAX_ITEMS


def test_deprecated_class_member_array_preserves_filters_and_authorization_on_overflow(client):
    teacher = _register_and_login(client, "legacy_member_limit_teacher", "teacher")
    outsider = _register_and_login(client, "legacy_member_limit_outsider", "teacher")
    _, class_id, _, _ = _create_learning_scope(client, str(teacher["token"]), "Legacy Member Limit")

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        users = _student_users("legacy_member_limit_student")
        db.add_all(users)
        db.flush()
        db.add_all(
            ClassMembership(class_id=class_id, user_id=user.id, role="student", status="active")
            for user in users
        )
        db.commit()

    query = "role=student&status=active"
    legacy = client.get(
        f"/api/classes/{class_id}/members?{query}",
        headers=_auth(str(teacher["token"])),
    )
    assert legacy.status_code == 409
    assert legacy.json()["detail"]["paged_endpoint"] == (
        f"/api/classes/{class_id}/members/page?role=student&status=active&limit=200&offset=0"
    )
    page = client.get(
        f"/api/classes/{class_id}/members/page?{query}&limit=200&offset=0",
        headers=_auth(str(teacher["token"])),
    )
    assert page.status_code == 200
    assert page.json()["total"] == LEGACY_LIST_PROBE_ITEMS
    assert len(page.json()["items"]) == LEGACY_LIST_MAX_ITEMS
    assert page.json()["next_offset"] == LEGACY_LIST_MAX_ITEMS
    assert client.get(
        f"/api/classes/{class_id}/members?{query}",
        headers=_auth(str(outsider["token"])),
    ).status_code == 403


def test_deprecated_assignment_submission_array_preserves_class_filter_on_overflow(client):
    teacher = _register_and_login(client, "legacy_submission_limit_teacher", "teacher")
    _, class_id, course_id, unit_id = _create_learning_scope(
        client,
        str(teacher["token"]),
        "Legacy Submission Limit",
    )
    assignment = client.post(
        f"/api/courses/{course_id}/units/{unit_id}/assignments",
        headers=_auth(str(teacher["token"])),
        json={"title": "Legacy Submission Limit Assignment", "status": "active", "max_score": 100},
    )
    assert assignment.status_code == 201, assignment.json()
    assignment_id = assignment.json()["id"]

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        users = _student_users("legacy_submission_limit_student")
        db.add_all(users)
        db.flush()
        db.add_all(
            Submission(
                assignment_id=assignment_id,
                student_id=user.id,
                class_id=class_id,
                content={"sequence": index},
                status="submitted",
            )
            for index, user in enumerate(users)
        )
        db.commit()

    legacy = client.get(
        f"/api/assignments/{assignment_id}/submissions?class_id={class_id}",
        headers=_auth(str(teacher["token"])),
    )
    assert legacy.status_code == 409
    assert legacy.json()["detail"]["paged_endpoint"] == (
        f"/api/assignments/{assignment_id}/submissions/page?class_id={class_id}&limit=200&offset=0"
    )
    page = client.get(
        f"/api/assignments/{assignment_id}/submissions/page?class_id={class_id}&limit=200&offset=0",
        headers=_auth(str(teacher["token"])),
    )
    assert page.status_code == 200
    assert page.json()["total"] == LEGACY_LIST_PROBE_ITEMS
    assert len(page.json()["items"]) == LEGACY_LIST_MAX_ITEMS
    assert page.json()["next_offset"] == LEGACY_LIST_MAX_ITEMS


def test_deprecated_code_attempt_array_is_bounded_without_weakening_owner_scope(client):
    teacher = _register_and_login(client, "legacy_attempt_limit_teacher", "teacher")
    student = _register_and_login(client, "legacy_attempt_limit_student", "student")
    outsider = _register_and_login(client, "legacy_attempt_limit_outsider", "student")
    _, class_id, course_id, unit_id = _create_learning_scope(
        client,
        str(teacher["token"]),
        "Legacy Attempt Limit",
    )
    joined = client.post(
        f"/api/classes/{class_id}/join",
        headers=_auth(str(student["token"])),
        json={"role": "student"},
    )
    assert joined.status_code == 201, joined.json()
    problem = client.post(
        "/api/code-problems",
        headers=_auth(str(teacher["token"])),
        json={
            "course_id": course_id,
            "course_unit_id": unit_id,
            "title": "Legacy Attempt Limit Problem",
            "statement_markdown": "Return one.",
            "test_cases": [{"stdin": "", "expected_stdout": "1\n"}],
            "language_allowlist": ["python"],
            "resource_policy": {
                "cpu_time_ms": 500,
                "wall_time_ms": 1000,
                "memory_kb": 65536,
                "output_max_bytes": 4096,
                "process_limit": 1,
                "network_enabled": False,
                "filesystem_mode": "none",
            },
            "source_max_bytes": 128,
            "input_max_bytes": 16,
            "output_max_bytes": 4096,
        },
    )
    assert problem.status_code == 201, problem.json()
    submitted = client.post(
        f"/api/code-problems/{problem.json()['id']}/submissions",
        headers=_auth(str(student["token"])),
        json={"class_id": class_id, "language": "python", "source_code": "print(1)", "stdin": ""},
    )
    assert submitted.status_code == 201, submitted.json()
    submission_id = submitted.json()["id"]

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        db.add_all(
            CodeJudgeAttempt(
                submission_id=submission_id,
                attempt_number=attempt_number,
                status="runner_unavailable",
                adapter_name="disabled",
                error_code="runner_disabled",
            )
            for attempt_number in range(2, LEGACY_LIST_PROBE_ITEMS + 1)
        )
        db.commit()

    legacy = client.get(
        f"/api/code-submissions/{submission_id}/attempts",
        headers=_auth(str(student["token"])),
    )
    assert legacy.status_code == 409
    assert legacy.json()["detail"]["paged_endpoint"] == (
        f"/api/code-submissions/{submission_id}/attempts/page?limit=200&offset=0"
    )
    page = client.get(
        f"/api/code-submissions/{submission_id}/attempts/page?limit=200&offset=0",
        headers=_auth(str(student["token"])),
    )
    assert page.status_code == 200
    assert page.json()["total"] == LEGACY_LIST_PROBE_ITEMS
    assert len(page.json()["items"]) == LEGACY_LIST_MAX_ITEMS
    assert page.json()["next_offset"] == LEGACY_LIST_MAX_ITEMS
    assert client.get(
        f"/api/code-submissions/{submission_id}/attempts",
        headers=_auth(str(outsider["token"])),
    ).status_code == 403
