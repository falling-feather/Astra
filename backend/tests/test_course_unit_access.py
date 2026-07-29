import json
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
import pytest
from sqlalchemy import select

from app.core.config import get_settings
from app.db.session import get_session_factory
from app.models import (
    ClassGroup,
    ClassMembership,
    Course,
    CourseClass,
    CourseUnit,
    CourseUnitClassPlan,
    School,
    User,
)
from app.services import course_unit_access as course_unit_access_service


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Cookie": ""}


def _login(client, username: str, role: str) -> str:
    password = "Unit-access-test-password-123"
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
    return logged_in.json()["access_token"]


def _bootstrap_admin(client, username: str) -> str:
    password = "Unit-access-admin-password-123"
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
    return logged_in.json()["access_token"]


def _school(client, teacher: str, name: str) -> int:
    response = client.post(
        "/api/schools",
        headers=_auth(teacher),
        json={"name": name},
    )
    assert response.status_code == 201, response.json()
    return response.json()["id"]


def _class(client, teacher: str, school_id: int, name: str) -> int:
    response = client.post(
        "/api/classes",
        headers=_auth(teacher),
        json={"school_id": school_id, "name": name},
    )
    assert response.status_code == 201, response.json()
    return response.json()["id"]


def _course(
    client,
    teacher: str,
    school_id: int,
    slug: str,
    *,
    status: str = "published",
) -> int:
    response = client.post(
        "/api/courses",
        headers=_auth(teacher),
        json={
            "school_id": school_id,
            "galaxy_key": "englab",
            "course_key": f"unit-access-{slug}",
            "title": f"Unit Access {slug}",
            "status": status,
        },
    )
    assert response.status_code == 201, response.json()
    return response.json()["id"]


def _attach(client, teacher: str, course_id: int, class_id: int) -> None:
    response = client.post(
        f"/api/courses/{course_id}/classes",
        headers=_auth(teacher),
        json={"class_id": class_id},
    )
    assert response.status_code == 201, response.json()


def _unit(
    client,
    teacher: str,
    course_id: int,
    *,
    activity_key: str,
    position: int,
    title: str,
    content_slug: str,
    status: str = "published",
) -> int:
    response = client.post(
        f"/api/courses/{course_id}/units",
        headers=_auth(teacher),
        json={
            "activity_key": activity_key,
            "title": title,
            "position": position,
            "content_slug": content_slug,
            "status": status,
        },
    )
    assert response.status_code == 201, response.json()
    return response.json()["id"]


def _join(client, student: str, class_id: int) -> None:
    response = client.post(
        f"/api/classes/{class_id}/join",
        headers=_auth(student),
        json={"role": "student"},
    )
    assert response.status_code == 201, response.json()


def _access(
    client,
    token: str,
    *,
    course_id: int,
    class_id: int,
    activity_key: str,
):
    return client.get(
        f"/api/courses/{course_id}/unit-access",
        headers=_auth(token),
        params={"class_id": class_id, "activity_key": activity_key},
    )


def _assert_safe_disposition(response, available: bool, error_code: str | None) -> None:
    assert response.status_code == 200, response.json()
    assert response.json() == {
        "available": available,
        "error_code": error_code,
    }


def test_student_unit_access_returns_safe_exact_dispositions_by_class(client):
    teacher = _login(client, "unit_access_teacher", "teacher")
    student = _login(client, "unit_access_student", "student")
    school_id = _school(client, teacher, "Unit Access School")
    class_one = _class(client, teacher, school_id, "Unit Access Class One")
    class_two = _class(client, teacher, school_id, "Unit Access Class Two")
    course_id = _course(client, teacher, school_id, "dispositions")
    _attach(client, teacher, course_id, class_one)
    _attach(client, teacher, course_id, class_two)
    open_unit_id = _unit(
        client,
        teacher,
        course_id,
        activity_key="unit-access.open",
        position=1,
        title="Open Unit Metadata",
        content_slug="open-unit-secret-slug",
    )
    locked_unit_id = _unit(
        client,
        teacher,
        course_id,
        activity_key="unit-access.locked",
        position=2,
        title="Locked Unit Metadata",
        content_slug="locked-unit-secret-slug",
    )
    hidden_unit_id = _unit(
        client,
        teacher,
        course_id,
        activity_key="unit-access.hidden",
        position=3,
        title="Hidden Unit Private Metadata",
        content_slug="hidden-unit-private-slug",
    )
    _join(client, student, class_one)
    _join(client, student, class_two)
    changed = client.patch(
        f"/api/courses/{course_id}/classes/{class_one}/release-plan",
        headers=_auth(teacher),
        json={
            "expected_version": 1,
            "items": [
                {"course_unit_id": locked_unit_id, "release_mode": "locked"},
                {"course_unit_id": hidden_unit_id, "release_mode": "hidden"},
            ],
        },
    )
    assert changed.status_code == 200, changed.json()

    _assert_safe_disposition(
        _access(
            client,
            student,
            course_id=course_id,
            class_id=class_one,
            activity_key="unit-access.open",
        ),
        True,
        None,
    )
    _assert_safe_disposition(
        _access(
            client,
            student,
            course_id=course_id,
            class_id=class_one,
            activity_key="unit-access.locked",
        ),
        False,
        "activity_locked",
    )
    hidden = _access(
        client,
        student,
        course_id=course_id,
        class_id=class_one,
        activity_key="unit-access.hidden",
    )
    _assert_safe_disposition(hidden, False, "activity_hidden")
    missing = _access(
        client,
        student,
        course_id=course_id,
        class_id=class_one,
        activity_key="unit-access.missing",
    )
    _assert_safe_disposition(missing, False, "course_unit_missing")

    _assert_safe_disposition(
        _access(
            client,
            student,
            course_id=course_id,
            class_id=class_two,
            activity_key="unit-access.hidden",
        ),
        True,
        None,
    )
    serialized_dispositions = json.dumps(
        {"hidden": hidden.json(), "missing": missing.json()}
    ).lower()
    for forbidden in (
        str(open_unit_id),
        str(locked_unit_id),
        str(hidden_unit_id),
        "title",
        "content",
        "slug",
        "release",
        "lock",
        "unit-access.hidden",
        "private",
    ):
        assert forbidden not in serialized_dispositions

    student_units = client.get(
        f"/api/courses/{course_id}/units",
        headers=_auth(student),
        params={"class_id": class_one},
    )
    assert student_units.status_code == 200, student_units.json()
    assert {item["activity_key"] for item in student_units.json()} == {
        "unit-access.open",
        "unit-access.locked",
    }
    assert "Hidden Unit Private Metadata" not in json.dumps(student_units.json())
    assert "hidden-unit-private-slug" not in json.dumps(student_units.json())


def test_student_unit_access_maps_unit_status_and_effective_locks_without_reasons(
    client,
):
    teacher = _login(client, "unit_access_state_teacher", "teacher")
    student = _login(client, "unit_access_state_student", "student")
    school_id = _school(client, teacher, "Unit Access State School")
    class_id = _class(client, teacher, school_id, "Unit Access State Class")
    course_id = _course(client, teacher, school_id, "effective-states")
    _attach(client, teacher, course_id, class_id)
    prerequisite_unit_id = _unit(
        client,
        teacher,
        course_id,
        activity_key="unit-access.prerequisite-source",
        position=1,
        title="Prerequisite Source",
        content_slug="prerequisite-source",
    )
    _unit(
        client,
        teacher,
        course_id,
        activity_key="unit-access.draft",
        position=2,
        title="Draft Unit Private Metadata",
        content_slug="draft-unit-private-slug",
        status="draft",
    )
    _unit(
        client,
        teacher,
        course_id,
        activity_key="unit-access.archived",
        position=3,
        title="Archived Unit Private Metadata",
        content_slug="archived-unit-private-slug",
        status="archived",
    )
    scheduled_unit_id = _unit(
        client,
        teacher,
        course_id,
        activity_key="unit-access.scheduled",
        position=4,
        title="Scheduled Unit Private Metadata",
        content_slug="scheduled-unit-private-slug",
    )
    prerequisite_locked_unit_id = _unit(
        client,
        teacher,
        course_id,
        activity_key="unit-access.prerequisite-locked",
        position=5,
        title="Prerequisite Locked Private Metadata",
        content_slug="prerequisite-locked-private-slug",
    )
    _join(client, student, class_id)
    changed = client.patch(
        f"/api/courses/{course_id}/classes/{class_id}/release-plan",
        headers=_auth(teacher),
        json={
            "expected_version": 1,
            "items": [
                {
                    "course_unit_id": scheduled_unit_id,
                    "open_at": (
                        datetime.now(timezone.utc) + timedelta(days=1)
                    ).isoformat(),
                },
                {
                    "course_unit_id": prerequisite_locked_unit_id,
                    "prerequisite_unit_id": prerequisite_unit_id,
                },
            ],
        },
    )
    assert changed.status_code == 200, changed.json()

    for activity_key in ("unit-access.draft", "unit-access.archived"):
        _assert_safe_disposition(
            _access(
                client,
                student,
                course_id=course_id,
                class_id=class_id,
                activity_key=activity_key,
            ),
            False,
            "activity_hidden",
        )
    for activity_key in (
        "unit-access.scheduled",
        "unit-access.prerequisite-locked",
    ):
        locked = _access(
            client,
            student,
            course_id=course_id,
            class_id=class_id,
            activity_key=activity_key,
        )
        _assert_safe_disposition(locked, False, "activity_locked")
        serialized = json.dumps(locked.json()).lower()
        assert "scheduled" not in serialized
        assert "prerequisite" not in serialized
        assert "reason" not in serialized


def test_student_unit_access_rejects_identity_scope_and_inactive_organization(client):
    teacher = _login(client, "unit_access_scope_teacher", "teacher")
    student = _login(client, "unit_access_scope_student", "student")
    outsider = _login(client, "unit_access_scope_outsider", "student")
    admin = _bootstrap_admin(client, "unit_access_scope_admin")
    school_id = _school(client, teacher, "Unit Access Scope School")
    class_id = _class(client, teacher, school_id, "Unit Access Scope Class")
    other_class_id = _class(
        client,
        teacher,
        school_id,
        "Unit Access Scope Other Class",
    )
    course_id = _course(client, teacher, school_id, "scope")
    _attach(client, teacher, course_id, class_id)
    _attach(client, teacher, course_id, other_class_id)
    _unit(
        client,
        teacher,
        course_id,
        activity_key="unit-access.scope",
        position=1,
        title="Scoped Unit",
        content_slug="scoped-unit",
    )
    _join(client, student, class_id)

    unauthenticated = client.get(
        f"/api/courses/{course_id}/unit-access",
        headers={"Cookie": ""},
        params={"class_id": class_id, "activity_key": "unit-access.scope"},
    )
    assert unauthenticated.status_code == 401, unauthenticated.json()
    missing_class_id = client.get(
        f"/api/courses/{course_id}/unit-access",
        headers=_auth(student),
        params={"activity_key": "unit-access.scope"},
    )
    assert missing_class_id.status_code == 422, missing_class_id.json()
    for token in (teacher, admin):
        forbidden_role = _access(
            client,
            token,
            course_id=course_id,
            class_id=class_id,
            activity_key="unit-access.scope",
        )
        assert forbidden_role.status_code == 403, forbidden_role.json()
    for token, denied_class_id in (
        (outsider, class_id),
        (student, other_class_id),
    ):
        forbidden_scope = _access(
            client,
            token,
            course_id=course_id,
            class_id=denied_class_id,
            activity_key="unit-access.scope",
        )
        assert forbidden_scope.status_code == 403, forbidden_scope.json()

    other_school_id = _school(
        client,
        teacher,
        "Unit Access Cross School",
    )
    cross_class_id = _class(
        client,
        teacher,
        other_school_id,
        "Unit Access Cross School Class",
    )
    cross_course_id = _course(
        client,
        teacher,
        other_school_id,
        "cross-school",
    )
    _attach(client, teacher, cross_course_id, cross_class_id)
    _join(client, student, cross_class_id)
    _assert_safe_disposition(
        _access(
            client,
            student,
            course_id=cross_course_id,
            class_id=cross_class_id,
            activity_key="unit-access.scope",
        ),
        False,
        "course_unit_missing",
    )
    cross_school_class_mismatch = _access(
        client,
        student,
        course_id=course_id,
        class_id=cross_class_id,
        activity_key="unit-access.scope",
    )
    assert (
        cross_school_class_mismatch.status_code == 403
    ), cross_school_class_mismatch.json()
    cross_school_course_mismatch = _access(
        client,
        student,
        course_id=cross_course_id,
        class_id=class_id,
        activity_key="unit-access.scope",
    )
    assert (
        cross_school_course_mismatch.status_code == 403
    ), cross_school_course_mismatch.json()

    for status in ("draft", "archived"):
        unavailable_course_id = _course(
            client,
            teacher,
            school_id,
            status,
            status=status,
        )
        _attach(client, teacher, unavailable_course_id, class_id)
        unavailable_course = _access(
            client,
            student,
            course_id=unavailable_course_id,
            class_id=class_id,
            activity_key="unit-access.scope",
        )
        assert unavailable_course.status_code == 403, unavailable_course.json()

    for params in (
        {"class_id": 0, "activity_key": "unit-access.scope"},
        {"class_id": class_id, "activity_key": "Unit-Access.Scope"},
        {"class_id": class_id, "activity_key": "unit..access"},
        {"class_id": class_id, "activity_key": "a" * 121},
    ):
        invalid = client.get(
            f"/api/courses/{course_id}/unit-access",
            headers=_auth(student),
            params=params,
        )
        assert invalid.status_code == 422, invalid.json()

    with get_session_factory(get_settings().database_url)() as db:
        stored_student = db.scalar(
            select(User).where(User.username == "unit_access_scope_student")
        )
        assert stored_student is not None
        membership = db.scalar(
            select(ClassMembership).where(
                ClassMembership.class_id == class_id,
                ClassMembership.user_id == stored_student.id,
                ClassMembership.role == "student",
            )
        )
        assert membership is not None
        membership.status = "inactive"
        db.commit()
        inactive_membership = _access(
            client,
            student,
            course_id=course_id,
            class_id=class_id,
            activity_key="unit-access.scope",
        )
        assert inactive_membership.status_code == 403, inactive_membership.json()
        membership.status = "active"
        db.commit()

        class_group = db.get(ClassGroup, class_id)
        assert class_group is not None
        class_group.status = "inactive"
        db.commit()
        inactive_class = _access(
            client,
            student,
            course_id=course_id,
            class_id=class_id,
            activity_key="unit-access.scope",
        )
        assert inactive_class.status_code == 403, inactive_class.json()
        class_group.status = "active"
        db.commit()

        course_class = db.scalar(
            select(CourseClass).where(
                CourseClass.course_id == course_id,
                CourseClass.class_id == class_id,
            )
        )
        assert course_class is not None
        course_class.status = "inactive"
        db.commit()
        inactive_course_class = _access(
            client,
            student,
            course_id=course_id,
            class_id=class_id,
            activity_key="unit-access.scope",
        )
        assert (
            inactive_course_class.status_code == 403
        ), inactive_course_class.json()
        course_class.status = "active"
        db.commit()

        school = db.get(School, school_id)
        assert school is not None
        school.status = "inactive"
        db.commit()
    inactive_school = _access(
        client,
        student,
        course_id=course_id,
        class_id=class_id,
        activity_key="unit-access.scope",
    )
    assert inactive_school.status_code == 403, inactive_school.json()


def test_student_unit_access_reads_only_target_plan_and_fails_closed_if_missing(
    client,
):
    teacher = _login(client, "unit_access_plan_teacher", "teacher")
    student = _login(client, "unit_access_plan_student", "student")
    school_id = _school(client, teacher, "Unit Access Plan School")
    class_id = _class(client, teacher, school_id, "Unit Access Plan Class")
    course_id = _course(client, teacher, school_id, "plan-scope")
    _attach(client, teacher, course_id, class_id)
    target_unit_id = _unit(
        client,
        teacher,
        course_id,
        activity_key="unit-access.plan-target",
        position=1,
        title="Target Unit",
        content_slug="target-unit",
    )
    unrelated_unit_id = _unit(
        client,
        teacher,
        course_id,
        activity_key="unit-access.plan-unrelated",
        position=2,
        title="Unrelated Unit",
        content_slug="unrelated-unit",
    )
    _join(client, student, class_id)

    with get_session_factory(get_settings().database_url)() as db:
        course_class = db.scalar(
            select(CourseClass).where(
                CourseClass.course_id == course_id,
                CourseClass.class_id == class_id,
            )
        )
        assert course_class is not None
        unrelated_plan = db.scalar(
            select(CourseUnitClassPlan).where(
                CourseUnitClassPlan.course_class_id == course_class.id,
                CourseUnitClassPlan.course_unit_id == unrelated_unit_id,
            )
        )
        assert unrelated_plan is not None
        db.delete(unrelated_plan)
        db.commit()

    _assert_safe_disposition(
        _access(
            client,
            student,
            course_id=course_id,
            class_id=class_id,
            activity_key="unit-access.plan-target",
        ),
        True,
        None,
    )

    with get_session_factory(get_settings().database_url)() as db:
        course_class = db.scalar(
            select(CourseClass).where(
                CourseClass.course_id == course_id,
                CourseClass.class_id == class_id,
            )
        )
        assert course_class is not None
        target_plan = db.scalar(
            select(CourseUnitClassPlan).where(
                CourseUnitClassPlan.course_class_id == course_class.id,
                CourseUnitClassPlan.course_unit_id == target_unit_id,
            )
        )
        assert target_plan is not None
        db.delete(target_plan)
        db.commit()

    missing_target_plan = _access(
        client,
        student,
        course_id=course_id,
        class_id=class_id,
        activity_key="unit-access.plan-target",
    )
    assert missing_target_plan.status_code == 409, missing_target_plan.json()
    assert missing_target_plan.json() == {
        "detail": "Course release plan is inconsistent"
    }


class _DuplicateScalarResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _DuplicateUnitSession:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self, _statement):
        return _DuplicateScalarResult(self._rows)


def test_student_unit_access_fails_closed_on_duplicate_activity_matches(monkeypatch):
    actor = User(id=7, role="student", status="active")
    course = Course(id=11, school_id=13, status="published")
    class_group = ClassGroup(id=17, school_id=13, status="active")
    course_class = CourseClass(
        id=19,
        course_id=11,
        class_id=17,
        status="active",
    )
    duplicate_units = [
        CourseUnit(
            id=23,
            course_id=11,
            activity_key="unit-access.duplicate",
            title="First Private Unit",
        ),
        CourseUnit(
            id=29,
            course_id=11,
            activity_key="unit-access.duplicate",
            title="Second Private Unit",
        ),
    ]
    monkeypatch.setattr(
        course_unit_access_service,
        "require_course_visible",
        lambda _db, _actor, _course_id: course,
    )
    monkeypatch.setattr(
        course_unit_access_service,
        "resolve_student_course_class",
        lambda _db, **_kwargs: class_group,
    )
    monkeypatch.setattr(
        course_unit_access_service,
        "get_course_class_or_404",
        lambda _db, _course_id, _class_id: course_class,
    )

    with pytest.raises(HTTPException) as duplicate:
        course_unit_access_service.student_course_unit_access(
            _DuplicateUnitSession(duplicate_units),
            actor=actor,
            course_id=course.id,
            class_id=class_group.id,
            activity_key="unit-access.duplicate",
        )
    assert duplicate.value.status_code == 409
    assert duplicate.value.detail == "Course unit activity scope is inconsistent"
    assert "First Private Unit" not in duplicate.value.detail
    assert "Second Private Unit" not in duplicate.value.detail


def test_student_unit_access_fails_closed_on_mismatched_target_plan(monkeypatch):
    actor = User(id=37, role="student", status="active")
    course = Course(id=41, school_id=43, status="published")
    class_group = ClassGroup(id=47, school_id=43, status="active")
    course_class = CourseClass(
        id=53,
        course_id=41,
        class_id=47,
        status="active",
    )
    unit = CourseUnit(
        id=59,
        course_id=41,
        activity_key="unit-access.plan-mismatch",
        title="Target Private Unit",
    )
    mismatched_plan = CourseUnitClassPlan(
        id=61,
        course_class_id=67,
        course_unit_id=71,
        position=1,
        release_mode="open",
    )
    monkeypatch.setattr(
        course_unit_access_service,
        "require_course_visible",
        lambda _db, _actor, _course_id: course,
    )
    monkeypatch.setattr(
        course_unit_access_service,
        "resolve_student_course_class",
        lambda _db, **_kwargs: class_group,
    )
    monkeypatch.setattr(
        course_unit_access_service,
        "get_course_class_or_404",
        lambda _db, _course_id, _class_id: course_class,
    )
    monkeypatch.setattr(
        course_unit_access_service,
        "get_plan_for_unit",
        lambda _db, _course_class, _unit_id: mismatched_plan,
    )

    with pytest.raises(HTTPException) as mismatch:
        course_unit_access_service.student_course_unit_access(
            _DuplicateUnitSession([unit]),
            actor=actor,
            course_id=course.id,
            class_id=class_group.id,
            activity_key=unit.activity_key,
        )
    assert mismatch.value.status_code == 409
    assert mismatch.value.detail == "Course release plan is inconsistent"
    assert "Target Private Unit" not in mismatch.value.detail
