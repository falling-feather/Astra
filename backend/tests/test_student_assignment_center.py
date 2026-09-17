from app.core.config import get_settings
from app.db.session import get_session_factory
from app.models import User


def _auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Cookie": ""}


def _register_and_login(client, username: str, role: str) -> dict:
    response = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "password": "secret123",
            "display_name": username.replace("_", " ").title(),
            "role": role,
        },
    )
    assert response.status_code == 201
    login = client.post(
        "/api/auth/login",
        json={"username": username, "password": "secret123"},
    )
    assert login.status_code == 200
    me = client.get("/api/users/me", headers=_auth_header(login.json()["access_token"]))
    assert me.status_code == 200
    return {**me.json(), "token": login.json()["access_token"]}


def _create_school(client, teacher: dict, name: str) -> int:
    response = client.post(
        "/api/schools",
        headers=_auth_header(teacher["token"]),
        json={"name": name},
    )
    assert response.status_code == 201
    return response.json()["id"]


def _create_class(client, teacher: dict, school_id: int, name: str) -> int:
    response = client.post(
        "/api/classes",
        headers=_auth_header(teacher["token"]),
        json={"school_id": school_id, "name": name},
    )
    assert response.status_code == 201
    return response.json()["id"]


def _join_class(client, student: dict, class_id: int) -> dict:
    response = client.post(
        f"/api/classes/{class_id}/join",
        headers=_auth_header(student["token"]),
        json={"role": "student"},
    )
    assert response.status_code == 201
    return response.json()


def _create_course(client, teacher: dict, school_id: int, title: str, *, status: str = "published") -> int:
    response = client.post(
        "/api/courses",
        headers=_auth_header(teacher["token"]),
        json={"school_id": school_id, "title": title, "status": status},
    )
    assert response.status_code == 201
    return response.json()["id"]


def _attach_course(client, teacher: dict, course_id: int, class_id: int) -> None:
    response = client.post(
        f"/api/courses/{course_id}/classes",
        headers=_auth_header(teacher["token"]),
        json={"class_id": class_id},
    )
    assert response.status_code == 201


def _create_unit(
    client,
    teacher: dict,
    course_id: int,
    title: str,
    position: int,
    *,
    status: str = "published",
) -> int:
    response = client.post(
        f"/api/courses/{course_id}/units",
        headers=_auth_header(teacher["token"]),
        json={"title": title, "position": position, "status": status},
    )
    assert response.status_code == 201
    return response.json()["id"]


def _create_assignment(
    client,
    teacher: dict,
    course_id: int,
    unit_id: int,
    title: str,
    *,
    status: str = "active",
) -> int:
    response = client.post(
        f"/api/courses/{course_id}/units/{unit_id}/assignments",
        headers=_auth_header(teacher["token"]),
        json={"title": title, "max_score": 20, "status": status},
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_class_list_mine_intersects_school_and_active_membership(client):
    teacher = _register_and_login(client, "mine_teacher", "teacher")
    student = _register_and_login(client, "mine_student", "student")
    first_school_id = _create_school(client, teacher, "Mine First School")
    first_class_id = _create_class(client, teacher, first_school_id, "Mine Active Class")
    inactive_class_id = _create_class(client, teacher, first_school_id, "Mine Inactive Class")
    second_school_id = _create_school(client, teacher, "Mine Second School")
    second_class_id = _create_class(client, teacher, second_school_id, "Mine Second Class")

    _join_class(client, student, first_class_id)
    inactive_membership = _join_class(client, student, inactive_class_id)
    _join_class(client, student, second_class_id)
    deactivate = client.patch(
        f"/api/classes/{inactive_class_id}/members/{inactive_membership['id']}",
        headers=_auth_header(teacher["token"]),
        json={"status": "inactive"},
    )
    assert deactivate.status_code == 200

    mine = client.get("/api/classes?mine=true", headers=_auth_header(student["token"]))
    assert mine.status_code == 200
    assert [item["id"] for item in mine.json()] == [first_class_id, second_class_id]

    mine_in_school = client.get(
        f"/api/classes?mine=true&school_id={first_school_id}",
        headers=_auth_header(student["token"]),
    )
    assert mine_in_school.status_code == 200
    assert [item["id"] for item in mine_in_school.json()] == [first_class_id]

    compatible_default = client.get(
        f"/api/classes?school_id={first_school_id}",
        headers=_auth_header(student["token"]),
    )
    assert compatible_default.status_code == 200
    assert [item["id"] for item in compatible_default.json()] == [first_class_id, inactive_class_id]


def test_role_drift_does_not_reuse_mismatched_class_membership(client):
    owner = _register_and_login(client, "role_drift_owner", "teacher")
    promoted_teacher = _register_and_login(client, "role_drift_promoted", "student")
    school_id = _create_school(client, owner, "Role Drift School")
    class_id = _create_class(client, owner, school_id, "Role Drift Class")
    _join_class(client, promoted_teacher, class_id)
    course_id = _create_course(client, owner, school_id, "Role Drift Course")
    _attach_course(client, owner, course_id, class_id)
    unit_id = _create_unit(client, owner, course_id, "Role Drift Unit", 1)
    assignment_id = _create_assignment(client, owner, course_id, unit_id, "Role Drift Assignment")

    with get_session_factory(get_settings().database_url)() as db:
        owner_user = db.get(User, owner["id"])
        promoted_user = db.get(User, promoted_teacher["id"])
        assert owner_user is not None
        assert promoted_user is not None
        owner_user.role = "student"
        promoted_user.role = "teacher"
        db.commit()

    downgraded_mine = client.get("/api/classes?mine=true", headers=_auth_header(owner["token"]))
    assert downgraded_mine.status_code == 200
    assert downgraded_mine.json() == []

    downgraded_center = client.get("/api/assignments/me", headers=_auth_header(owner["token"]))
    assert downgraded_center.status_code == 200
    assert downgraded_center.json()["items"] == []
    assert downgraded_center.json()["total"] == 0

    downgraded_review = client.get(
        f"/api/assignments/{assignment_id}/review?class_id={class_id}",
        headers=_auth_header(owner["token"]),
    )
    assert downgraded_review.status_code == 403

    downgraded_submit = client.post(
        f"/api/assignments/{assignment_id}/submissions",
        headers=_auth_header(owner["token"]),
        json={"class_id": class_id, "content": {"answer": "role drift must not submit"}},
    )
    assert downgraded_submit.status_code == 403

    downgraded_submissions = client.get(
        f"/api/assignments/{assignment_id}/submissions?class_id={class_id}",
        headers=_auth_header(owner["token"]),
    )
    assert downgraded_submissions.status_code == 403

    promoted_mine = client.get(
        "/api/classes?mine=true",
        headers=_auth_header(promoted_teacher["token"]),
    )
    assert promoted_mine.status_code == 200
    assert promoted_mine.json() == []

    with get_session_factory(get_settings().database_url)() as db:
        owner_user = db.get(User, owner["id"])
        assert owner_user is not None
        owner_user.role = "admin"
        db.commit()

    admin_mine = client.get("/api/classes?mine=true", headers=_auth_header(owner["token"]))
    assert admin_mine.status_code == 200
    assert [item["id"] for item in admin_mine.json()] == [class_id]


def test_student_assignment_center_scopes_filters_feedback_and_pagination(client):
    teacher = _register_and_login(client, "center_teacher", "teacher")
    student = _register_and_login(client, "center_student", "student")
    school_id = _create_school(client, teacher, "Assignment Center School")
    own_class_id = _create_class(client, teacher, school_id, "Assignment Center Own Class")
    other_class_id = _create_class(client, teacher, school_id, "Assignment Center Other Class")
    _join_class(client, student, own_class_id)

    course_id = _create_course(client, teacher, school_id, "Visible Assignment Center Course")
    _attach_course(client, teacher, course_id, own_class_id)
    unit_id = _create_unit(client, teacher, course_id, "Visible Assignment Center Unit", 1)
    open_assignment_id = _create_assignment(client, teacher, course_id, unit_id, "Open Assignment")
    feedback_assignment_id = _create_assignment(client, teacher, course_id, unit_id, "Feedback Assignment")
    closed_assignment_id = _create_assignment(
        client,
        teacher,
        course_id,
        unit_id,
        "Closed Assignment",
        status="closed",
    )
    archived_assignment_id = _create_assignment(
        client,
        teacher,
        course_id,
        unit_id,
        "Archived Assignment",
        status="archived",
    )

    hidden_unit_id = _create_unit(
        client,
        teacher,
        course_id,
        "Hidden Assignment Center Unit",
        2,
        status="draft",
    )
    hidden_assignment_id = _create_assignment(
        client,
        teacher,
        course_id,
        hidden_unit_id,
        "Hidden Unit Assignment",
    )

    draft_course_id = _create_course(
        client,
        teacher,
        school_id,
        "Draft Assignment Center Course",
        status="draft",
    )
    _attach_course(client, teacher, draft_course_id, own_class_id)
    draft_unit_id = _create_unit(client, teacher, draft_course_id, "Draft Course Unit", 1)
    draft_assignment_id = _create_assignment(
        client,
        teacher,
        draft_course_id,
        draft_unit_id,
        "Draft Course Assignment",
    )

    other_course_id = _create_course(client, teacher, school_id, "Other Class Course")
    _attach_course(client, teacher, other_course_id, other_class_id)
    other_unit_id = _create_unit(client, teacher, other_course_id, "Other Class Unit", 1)
    other_assignment_id = _create_assignment(
        client,
        teacher,
        other_course_id,
        other_unit_id,
        "Other Class Assignment",
    )

    submission = client.post(
        f"/api/assignments/{feedback_assignment_id}/submissions",
        headers=_auth_header(student["token"]),
        json={"class_id": own_class_id, "content": {"answer": "center answer"}},
    )
    assert submission.status_code == 201
    duplicate = client.post(
        f"/api/assignments/{feedback_assignment_id}/submissions",
        headers=_auth_header(student["token"]),
        json={"class_id": own_class_id, "content": {"answer": "duplicate"}},
    )
    assert duplicate.status_code == 409
    history = client.get(
        f"/api/v2/submissions/{submission.json()['id']}/history", headers=_auth_header(student["token"]),
    )
    assert history.status_code == 200
    assert history.json()["revision"] == 1
    assert history.json()["total"] == 1
    assert history.json()["attempts"][0]["content"] == {"answer": "center answer"}
    assert history.json()["grades"] == []
    unchanged_points = client.get("/api/points/ledger", headers=_auth_header(student["token"]))
    assert unchanged_points.status_code == 200
    assert unchanged_points.json() == []
    grade = client.patch(
        f"/api/submissions/{submission.json()['id']}/grade",
        headers=_auth_header(teacher["token"]),
        json={"score": 18, "feedback": "Focused feedback"},
    )
    assert grade.status_code == 200

    center = client.get(
        f"/api/assignments/me?class_id={own_class_id}",
        headers=_auth_header(student["token"]),
    )
    assert center.status_code == 200
    body = center.json()
    assert body["total"] == 4
    assert body["next_offset"] is None
    rows = {item["assignment"]["id"]: item for item in body["items"]}
    assert set(rows) == {
        open_assignment_id,
        feedback_assignment_id,
        closed_assignment_id,
        archived_assignment_id,
    }
    assert hidden_assignment_id not in rows
    assert draft_assignment_id not in rows
    assert other_assignment_id not in rows
    assert rows[open_assignment_id]["class"]["id"] == own_class_id
    assert rows[open_assignment_id]["course"]["id"] == course_id
    assert rows[open_assignment_id]["unit"]["id"] == unit_id
    assert rows[open_assignment_id]["submission"] is None
    assert rows[open_assignment_id]["can_submit"] is True
    assert rows[feedback_assignment_id]["submission"]["feedback"] == "Focused feedback"
    assert rows[feedback_assignment_id]["submit_block_reason"] == "already_submitted"
    assert rows[closed_assignment_id]["submit_block_reason"] == "assignment_closed"
    assert rows[archived_assignment_id]["submit_block_reason"] == "assignment_archived"

    active = client.get(
        "/api/assignments/me?filter=active",
        headers=_auth_header(student["token"]),
    )
    assert active.status_code == 200
    assert {item["assignment"]["id"] for item in active.json()["items"]} == {
        open_assignment_id,
        feedback_assignment_id,
    }
    feedback = client.get(
        "/api/assignments/me?filter=feedback",
        headers=_auth_header(student["token"]),
    )
    assert feedback.status_code == 200
    assert [item["assignment"]["id"] for item in feedback.json()["items"]] == [feedback_assignment_id]
    history = client.get(
        "/api/assignments/me?filter=history",
        headers=_auth_header(student["token"]),
    )
    assert history.status_code == 200
    assert {item["assignment"]["id"] for item in history.json()["items"]} == {
        closed_assignment_id,
        archived_assignment_id,
    }

    page = client.get(
        "/api/assignments/me?limit=1&offset=0",
        headers=_auth_header(student["token"]),
    )
    assert page.status_code == 200
    assert page.json()["total"] == 4
    assert len(page.json()["items"]) == 1
    assert page.json()["next_offset"] == 1

    outside_class = client.get(
        f"/api/assignments/me?class_id={other_class_id}",
        headers=_auth_header(student["token"]),
    )
    assert outside_class.status_code == 403
    outside_course = client.get(
        f"/api/assignments/me?course_id={other_course_id}",
        headers=_auth_header(student["token"]),
    )
    assert outside_course.status_code == 403
    teacher_forbidden = client.get(
        "/api/assignments/me",
        headers=_auth_header(teacher["token"]),
    )
    assert teacher_forbidden.status_code == 403

    own_events = client.get("/api/learning-events", headers=_auth_header(student["token"]))
    assert own_events.status_code == 200
    assert len(own_events.json()) == 1
    assert own_events.json()[0]["assignment_id"] == feedback_assignment_id
    assert own_events.json()[0]["event_type"] == "submit"


def test_assignment_review_requires_class_id_for_multiple_eligible_classes(client):
    teacher = _register_and_login(client, "review_scope_teacher", "teacher")
    student = _register_and_login(client, "review_scope_student", "student")
    school_id = _create_school(client, teacher, "Review Scope School")
    first_class_id = _create_class(client, teacher, school_id, "Review Scope First")
    second_class_id = _create_class(client, teacher, school_id, "Review Scope Second")
    _join_class(client, student, first_class_id)
    _join_class(client, student, second_class_id)
    course_id = _create_course(client, teacher, school_id, "Review Scope Course")
    _attach_course(client, teacher, course_id, first_class_id)
    _attach_course(client, teacher, course_id, second_class_id)
    unit_id = _create_unit(client, teacher, course_id, "Review Scope Unit", 1)
    assignment_id = _create_assignment(client, teacher, course_id, unit_id, "Review Scope Assignment")

    first_page = client.get(
        f"/api/assignments/me?course_id={course_id}&limit=1&offset=0",
        headers=_auth_header(student["token"]),
    )
    assert first_page.status_code == 200
    assert first_page.json()["total"] == 2
    assert first_page.json()["next_offset"] == 1
    assert first_page.json()["items"][0]["class"]["id"] == first_class_id
    assert first_page.json()["items"][0]["assignment"]["id"] == assignment_id

    second_page = client.get(
        f"/api/assignments/me?course_id={course_id}&limit=1&offset=1",
        headers=_auth_header(student["token"]),
    )
    assert second_page.status_code == 200
    assert second_page.json()["total"] == 2
    assert second_page.json()["next_offset"] is None
    assert second_page.json()["items"][0]["class"]["id"] == second_class_id
    assert second_page.json()["items"][0]["assignment"]["id"] == assignment_id

    ambiguous = client.get(
        f"/api/assignments/{assignment_id}/review",
        headers=_auth_header(student["token"]),
    )
    assert ambiguous.status_code == 422
    assert ambiguous.json()["detail"] == "class_id is required when assignment is available in multiple classes"

    first_review = client.get(
        f"/api/assignments/{assignment_id}/review?class_id={first_class_id}",
        headers=_auth_header(student["token"]),
    )
    second_review = client.get(
        f"/api/assignments/{assignment_id}/review?class_id={second_class_id}",
        headers=_auth_header(student["token"]),
    )
    assert first_review.status_code == 200
    assert first_review.json()["can_submit"] is True
    assert second_review.status_code == 200
    assert second_review.json()["can_submit"] is True

    first_submission = client.post(
        f"/api/assignments/{assignment_id}/submissions",
        headers=_auth_header(student["token"]),
        json={"class_id": first_class_id, "content": {"answer": "first"}},
    )
    assert first_submission.status_code == 201
    first_after_submit = client.get(
        f"/api/assignments/{assignment_id}/review?class_id={first_class_id}",
        headers=_auth_header(student["token"]),
    )
    second_after_submit = client.get(
        f"/api/assignments/{assignment_id}/review?class_id={second_class_id}",
        headers=_auth_header(student["token"]),
    )
    assert first_after_submit.json()["submit_block_reason"] == "already_submitted"
    assert second_after_submit.json()["can_submit"] is True
