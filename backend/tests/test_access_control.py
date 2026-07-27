from datetime import datetime

from sqlalchemy import select

from app.core.config import get_settings
from app.db.session import get_session_factory
from app.models import (
    ClassMembership,
    Course,
    CourseCollaborator,
    CourseUnit,
    SchoolMembership,
    User,
    UserKnowledgeSnapshot,
)
from app.services import knowledge_snapshot_runs


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
    login = client.post("/api/auth/login", json={"username": username, "password": "secret123"})
    assert login.status_code == 200
    me = client.get("/api/users/me", headers=_auth_header(login.json()["access_token"]))
    assert me.status_code == 200
    return {"token": login.json()["access_token"], "id": me.json()["id"]}


def _bootstrap_admin(client, username: str) -> str:
    response = client.post(
        "/api/admin/bootstrap",
        json={
            "username": username,
            "password": "secret123",
            "display_name": username.replace("_", " ").title(),
        },
    )
    assert response.status_code == 201
    login = client.post("/api/auth/login", json={"username": username, "password": "secret123"})
    assert login.status_code == 200
    return login.json()["access_token"]


def _create_learning_scope(client) -> dict:
    teacher = _register_and_login(client, "scope_teacher", "teacher")
    student = _register_and_login(client, "scope_student", "student")

    school = client.post(
        "/api/schools",
        headers=_auth_header(teacher["token"]),
        json={"name": "Scope Matrix School", "region": "Shanghai"},
    )
    assert school.status_code == 201
    school_id = school.json()["id"]

    class_response = client.post(
        "/api/classes",
        headers=_auth_header(teacher["token"]),
        json={"school_id": school_id, "name": "Scope Matrix Class", "grade": "10", "term": "2026A"},
    )
    assert class_response.status_code == 201
    class_id = class_response.json()["id"]

    course = client.post(
        "/api/courses",
        headers=_auth_header(teacher["token"]),
        json={"school_id": school_id, "title": "Scope Matrix Course", "status": "published"},
    )
    assert course.status_code == 201
    course_id = course.json()["id"]

    attach = client.post(
        f"/api/courses/{course_id}/classes",
        headers=_auth_header(teacher["token"]),
        json={"class_id": class_id},
    )
    assert attach.status_code == 201

    unit = client.post(
        f"/api/courses/{course_id}/units",
        headers=_auth_header(teacher["token"]),
        json={
            "title": "Scope Matrix Unit",
            "position": 1,
            "content_slug": "physics/energy-conservation",
            "status": "published",
        },
    )
    assert unit.status_code == 201
    unit_id = unit.json()["id"]

    assignment = client.post(
        f"/api/courses/{course_id}/units/{unit_id}/assignments",
        headers=_auth_header(teacher["token"]),
        json={"title": "Scope Matrix Assignment", "max_score": 20},
    )
    assert assignment.status_code == 201

    join = client.post(
        f"/api/classes/{class_id}/join",
        headers=_auth_header(student["token"]),
        json={"role": "student"},
    )
    assert join.status_code == 201

    return {
        "teacher": teacher,
        "student": student,
        "school_id": school_id,
        "class_id": class_id,
        "course_id": course_id,
        "unit_id": unit_id,
        "assignment_id": assignment.json()["id"],
    }


def _grant_school_teacher_membership(
    user_id: int,
    school_id: int,
    status: str = "active",
    role: str = "teacher",
) -> None:
    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        db.add(SchoolMembership(school_id=school_id, user_id=user_id, role=role, status=status))
        db.commit()


def _set_user_status(user_id: int, status: str) -> None:
    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        user = db.get(User, user_id)
        assert user is not None
        user.status = status
        db.commit()


def _set_school_teacher_membership_status(user_id: int, school_id: int, status: str) -> None:
    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        membership = db.scalar(
            select(SchoolMembership).where(
                SchoolMembership.school_id == school_id,
                SchoolMembership.user_id == user_id,
                SchoolMembership.role == "teacher",
            )
        )
        assert membership is not None
        membership.status = status
        db.commit()


def test_global_role_change_revokes_session_and_deactivates_stale_authority(client):
    scope = _create_learning_scope(client)
    admin_token = _bootstrap_admin(client, "admin_role_coherence")
    candidate = _register_and_login(client, "teacher_role_coherence", "teacher")
    _grant_school_teacher_membership(candidate["id"], scope["school_id"])
    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        db.add(
            ClassMembership(
                class_id=scope["class_id"],
                user_id=candidate["id"],
                role="teacher",
                status="active",
            )
        )
        db.commit()

    collaborator = client.post(
        f"/api/courses/{scope['course_id']}/collaborators",
        headers=_auth_header(scope["teacher"]["token"]),
        json={"user_id": candidate["id"], "role": "editor"},
    )
    assert collaborator.status_code == 201
    before = client.get(
        f"/api/admin/classes/{scope['class_id']}/stats",
        headers=_auth_header(candidate["token"]),
    )
    assert before.status_code == 200

    demote = client.patch(
        f"/api/admin/users/{candidate['id']}",
        headers=_auth_header(admin_token),
        json={"role": "student"},
    )
    assert demote.status_code == 200
    assert demote.json()["role"] == "student"
    assert client.get("/api/users/me", headers=_auth_header(candidate["token"])).status_code == 401

    relogin = client.post(
        "/api/auth/login",
        json={"username": "teacher_role_coherence", "password": "secret123"},
    )
    assert relogin.status_code == 200
    student_headers = _auth_header(relogin.json()["access_token"])
    assert client.get(f"/api/admin/classes/{scope['class_id']}/stats", headers=student_headers).status_code == 403
    assert client.post(
        "/api/classes",
        headers=student_headers,
        json={"school_id": scope["school_id"], "name": "Unauthorized Class"},
    ).status_code == 403

    with session_factory() as db:
        school_membership = db.scalar(
            select(SchoolMembership).where(
                SchoolMembership.user_id == candidate["id"],
                SchoolMembership.school_id == scope["school_id"],
                SchoolMembership.role == "teacher",
            )
        )
        class_membership = db.scalar(
            select(ClassMembership).where(
                ClassMembership.user_id == candidate["id"],
                ClassMembership.class_id == scope["class_id"],
                ClassMembership.role == "teacher",
            )
        )
        course_collaborator = db.scalar(
            select(CourseCollaborator).where(
                CourseCollaborator.user_id == candidate["id"],
                CourseCollaborator.course_id == scope["course_id"],
            )
        )
        assert school_membership.status == "inactive"
        assert class_membership.status == "inactive"
        assert course_collaborator.status == "inactive"


def test_outside_users_cannot_cross_school_class_course_boundaries(client):
    scope = _create_learning_scope(client)
    outsider_student = _register_and_login(client, "scope_outside_student", "student")
    outsider_teacher = _register_and_login(client, "scope_outside_teacher", "teacher")

    class_id = scope["class_id"]
    course_id = scope["course_id"]
    assignment_id = scope["assignment_id"]
    outside_student_headers = _auth_header(outsider_student["token"])
    outside_teacher_headers = _auth_header(outsider_teacher["token"])

    denied_requests = [
        (
            "student cannot list outside school classes",
            lambda: client.get(f"/api/classes?school_id={scope['school_id']}", headers=outside_student_headers),
        ),
        (
            "student cannot list outside school class route",
            lambda: client.get(f"/api/schools/{scope['school_id']}/classes", headers=outside_student_headers),
        ),
        (
            "student cannot list outside class courses",
            lambda: client.get(f"/api/courses?class_id={class_id}", headers=outside_student_headers),
        ),
        (
            "student cannot read outside course units",
            lambda: client.get(f"/api/courses/{course_id}/units", headers=outside_student_headers),
        ),
        (
            "student cannot read outside course assignments",
            lambda: client.get(f"/api/courses/{course_id}/assignments", headers=outside_student_headers),
        ),
        (
            "student cannot create outside learning event",
            lambda: client.post(
                "/api/learning-events",
                headers=outside_student_headers,
                json={"course_id": course_id, "class_id": class_id, "event_type": "visit", "payload": {}},
            ),
        ),
        (
            "student cannot submit outside assignment",
            lambda: client.post(
                f"/api/assignments/{assignment_id}/submissions",
                headers=outside_student_headers,
                json={"class_id": class_id, "content": {"answer": "outside"}},
            ),
        ),
        (
            "student cannot read outside assignment review",
            lambda: client.get(f"/api/assignments/{assignment_id}/review", headers=outside_student_headers),
        ),
        (
            "teacher cannot read outside student progress",
            lambda: client.get(
                f"/api/progress/users/{scope['student']['id']}?class_id={class_id}",
                headers=outside_teacher_headers,
            ),
        ),
        (
            "teacher cannot read outside point ledger",
            lambda: client.get(f"/api/points/ledger?class_id={class_id}", headers=outside_teacher_headers),
        ),
        (
            "teacher cannot read outside class knowledge",
            lambda: client.get(f"/api/classes/{class_id}/knowledge", headers=outside_teacher_headers),
        ),
    ]

    for label, request in denied_requests:
        response = request()
        assert response.status_code == 403, label


def test_school_teacher_without_class_scope_cannot_manage_class_assignments(client):
    scope = _create_learning_scope(client)
    peer_teacher = _register_and_login(client, "scope_peer_school_teacher", "teacher")
    _grant_school_teacher_membership(peer_teacher["id"], scope["school_id"])

    student_headers = _auth_header(scope["student"]["token"])
    teacher_headers = _auth_header(scope["teacher"]["token"])
    peer_headers = _auth_header(peer_teacher["token"])

    peer_attach = client.post(
        f"/api/courses/{scope['course_id']}/classes",
        headers=peer_headers,
        json={"class_id": scope["class_id"]},
    )
    assert peer_attach.status_code == 403
    assert peer_attach.json()["detail"] == "Course class attachment requires class teacher role"

    submission = client.post(
        f"/api/assignments/{scope['assignment_id']}/submissions",
        headers=student_headers,
        json={"class_id": scope["class_id"], "content": {"answer": "scoped submission"}},
    )
    assert submission.status_code == 201
    submission_id = submission.json()["id"]

    event = client.post(
        "/api/learning-events",
        headers=student_headers,
        json={"class_id": scope["class_id"], "assignment_id": scope["assignment_id"], "event_type": "start"},
    )
    assert event.status_code == 201

    peer_unscoped_list = client.get(
        f"/api/assignments/{scope['assignment_id']}/submissions",
        headers=peer_headers,
    )
    assert peer_unscoped_list.status_code == 200
    assert peer_unscoped_list.json() == []

    peer_class_list = client.get(
        f"/api/assignments/{scope['assignment_id']}/submissions?class_id={scope['class_id']}",
        headers=peer_headers,
    )
    assert peer_class_list.status_code == 403
    assert peer_class_list.json()["detail"] == "Assignment submissions require class teacher scope"

    peer_pending_queue = client.get("/api/admin/submissions/pending", headers=peer_headers)
    assert peer_pending_queue.status_code == 200
    assert peer_pending_queue.json()["total"] == 0
    assert peer_pending_queue.json()["items"] == []

    peer_course_pending_queue = client.get(
        f"/api/admin/submissions/pending?course_id={scope['course_id']}",
        headers=peer_headers,
    )
    assert peer_course_pending_queue.status_code == 200
    assert peer_course_pending_queue.json()["total"] == 0

    peer_class_pending_queue = client.get(
        f"/api/admin/submissions/pending?class_id={scope['class_id']}",
        headers=peer_headers,
    )
    assert peer_class_pending_queue.status_code == 403
    assert peer_class_pending_queue.json()["detail"] == "Pending submissions require class teacher scope"

    student_pending_queue = client.get("/api/admin/submissions/pending", headers=student_headers)
    assert student_pending_queue.status_code == 403
    assert student_pending_queue.json()["detail"] == "Pending submissions require class teacher scope"

    peer_grade = client.patch(
        f"/api/submissions/{submission_id}/grade",
        headers=peer_headers,
        json={"score": 12, "feedback": "out of scope"},
    )
    assert peer_grade.status_code == 403
    assert peer_grade.json()["detail"] == "Submission grading requires class teacher scope"

    peer_unscoped_events = client.get("/api/learning-events", headers=peer_headers)
    assert peer_unscoped_events.status_code == 200
    assert peer_unscoped_events.json() == []

    peer_class_events = client.get(f"/api/learning-events?class_id={scope['class_id']}", headers=peer_headers)
    assert peer_class_events.status_code == 403
    assert peer_class_events.json()["detail"] == "Learning events require class teacher scope"

    peer_progress = client.get(
        f"/api/progress/users/{scope['student']['id']}?class_id={scope['class_id']}",
        headers=peer_headers,
    )
    assert peer_progress.status_code == 403
    assert peer_progress.json()["detail"] == "Student progress requires class teacher scope"

    owner_class_list = client.get(
        f"/api/assignments/{scope['assignment_id']}/submissions?class_id={scope['class_id']}",
        headers=teacher_headers,
    )
    assert owner_class_list.status_code == 200
    assert [item["id"] for item in owner_class_list.json()] == [submission_id]

    owner_pending_queue = client.get("/api/admin/submissions/pending", headers=teacher_headers)
    assert owner_pending_queue.status_code == 200
    assert owner_pending_queue.json()["total"] == 1
    assert [item["id"] for item in owner_pending_queue.json()["items"]] == [submission_id]

    owner_class_pending_queue = client.get(
        f"/api/admin/submissions/pending?class_id={scope['class_id']}",
        headers=teacher_headers,
    )
    assert owner_class_pending_queue.status_code == 200
    assert owner_class_pending_queue.json()["total"] == 1

    owner_grade = client.patch(
        f"/api/submissions/{submission_id}/grade",
        headers=teacher_headers,
        json={"score": 12, "feedback": "in scope"},
    )
    assert owner_grade.status_code == 200
    assert owner_grade.json()["score"] == 12

    owner_graded_queue = client.get(
        f"/api/admin/submissions/pending?class_id={scope['class_id']}&status=graded",
        headers=teacher_headers,
    )
    assert owner_graded_queue.status_code == 403
    assert owner_graded_queue.json()["detail"] == "Graded submission queue requires admin role"

    peer_unscoped_points = client.get("/api/points/ledger", headers=peer_headers)
    assert peer_unscoped_points.status_code == 200
    assert peer_unscoped_points.json() == []

    peer_class_points = client.get(f"/api/points/ledger?class_id={scope['class_id']}", headers=peer_headers)
    assert peer_class_points.status_code == 403
    assert peer_class_points.json()["detail"] == "Point ledger requires class teacher scope"

    owner_events = client.get(f"/api/learning-events?class_id={scope['class_id']}", headers=teacher_headers)
    assert owner_events.status_code == 200
    assert event.json()["id"] in {item["id"] for item in owner_events.json()}

    owner_points = client.get(f"/api/points/ledger?class_id={scope['class_id']}", headers=teacher_headers)
    assert owner_points.status_code == 200
    assert [item["delta"] for item in owner_points.json()] == [12]

    owner_progress = client.get(
        f"/api/progress/users/{scope['student']['id']}?class_id={scope['class_id']}",
        headers=teacher_headers,
    )
    assert owner_progress.status_code == 200
    assert owner_progress.json()["total_points"] == 12


def test_course_editor_collaborator_scope_controls_course_structure(client):
    scope = _create_learning_scope(client)
    peer_teacher = _register_and_login(client, "scope_peer_course_editor", "teacher")
    _grant_school_teacher_membership(peer_teacher["id"], scope["school_id"])
    outside_teacher = _register_and_login(client, "scope_outside_course_editor", "teacher")
    inactive_teacher = _register_and_login(client, "scope_inactive_course_editor", "teacher")
    _grant_school_teacher_membership(inactive_teacher["id"], scope["school_id"], status="inactive")
    admin_managed_teacher = _register_and_login(client, "scope_admin_managed_course_editor", "teacher")
    _grant_school_teacher_membership(admin_managed_teacher["id"], scope["school_id"])
    admin_token = _bootstrap_admin(client, "admin_course_author_scope")

    teacher_headers = _auth_header(scope["teacher"]["token"])
    peer_headers = _auth_header(peer_teacher["token"])
    admin_headers = _auth_header(admin_token)

    peer_units = client.get(f"/api/courses/{scope['course_id']}/units", headers=peer_headers)
    assert peer_units.status_code == 200
    assert [item["id"] for item in peer_units.json()] == [scope["unit_id"]]

    peer_assignments = client.get(f"/api/courses/{scope['course_id']}/assignments", headers=peer_headers)
    assert peer_assignments.status_code == 200
    assert [item["id"] for item in peer_assignments.json()] == [scope["assignment_id"]]

    peer_collaborators = client.get(f"/api/courses/{scope['course_id']}/collaborators", headers=peer_headers)
    assert peer_collaborators.status_code == 403
    assert peer_collaborators.json()["detail"] == "Course collaborators require active collaborator role"

    peer_manage_collaborators = client.post(
        f"/api/courses/{scope['course_id']}/collaborators",
        headers=peer_headers,
        json={"user_id": outside_teacher["id"]},
    )
    assert peer_manage_collaborators.status_code == 403
    assert peer_manage_collaborators.json()["detail"] == "Course collaborator management requires course owner role"

    peer_unit_create = client.post(
        f"/api/courses/{scope['course_id']}/units",
        headers=peer_headers,
        json={"title": "Peer Edited Unit", "position": 2, "status": "published"},
    )
    assert peer_unit_create.status_code == 403
    assert peer_unit_create.json()["detail"] == "Course unit creation requires editor or content_editor role"

    peer_assignment_create = client.post(
        f"/api/courses/{scope['course_id']}/units/{scope['unit_id']}/assignments",
        headers=peer_headers,
        json={"title": "Peer Edited Assignment", "max_score": 20},
    )
    assert peer_assignment_create.status_code == 403
    assert peer_assignment_create.json()["detail"] == "Assignment creation requires active editing collaborator role"

    student_collaborator = client.post(
        f"/api/courses/{scope['course_id']}/collaborators",
        headers=teacher_headers,
        json={"user_id": scope["student"]["id"]},
    )
    assert student_collaborator.status_code == 422
    assert student_collaborator.json()["detail"] == "Course collaborator must be active school teacher/admin"

    outside_collaborator = client.post(
        f"/api/courses/{scope['course_id']}/collaborators",
        headers=teacher_headers,
        json={"user_id": outside_teacher["id"]},
    )
    assert outside_collaborator.status_code == 422
    assert outside_collaborator.json()["detail"] == "Course collaborator must be active school teacher/admin"

    inactive_school_collaborator = client.post(
        f"/api/courses/{scope['course_id']}/collaborators",
        headers=teacher_headers,
        json={"user_id": inactive_teacher["id"]},
    )
    assert inactive_school_collaborator.status_code == 422
    assert inactive_school_collaborator.json()["detail"] == "Course collaborator must be active school teacher/admin"

    owner_collaborator = client.post(
        f"/api/courses/{scope['course_id']}/collaborators",
        headers=teacher_headers,
        json={"user_id": scope["teacher"]["id"]},
    )
    assert owner_collaborator.status_code == 409
    assert owner_collaborator.json()["detail"] == "Course creator is already an owner"

    collaborator = client.post(
        f"/api/courses/{scope['course_id']}/collaborators",
        headers=teacher_headers,
        json={"user_id": peer_teacher["id"]},
    )
    assert collaborator.status_code == 201
    collaborator_id = collaborator.json()["id"]
    assert collaborator.json()["role"] == "editor"
    assert collaborator.json()["status"] == "active"

    duplicate_collaborator = client.post(
        f"/api/courses/{scope['course_id']}/collaborators",
        headers=teacher_headers,
        json={"user_id": peer_teacher["id"]},
    )
    assert duplicate_collaborator.status_code == 409
    assert duplicate_collaborator.json()["detail"] == "Course collaborator already exists"

    collaborator_audit = client.get(
        f"/api/admin/audit-logs?action=course.collaborator.create&resource_id={collaborator_id}",
        headers=admin_headers,
    )
    assert collaborator_audit.status_code == 200
    assert collaborator_audit.json()["total"] == 1
    assert collaborator_audit.json()["items"][0]["snapshot_json"]["after"]["user_id"] == peer_teacher["id"]

    peer_collaborators_after_grant = client.get(
        f"/api/courses/{scope['course_id']}/collaborators",
        headers=peer_headers,
    )
    assert peer_collaborators_after_grant.status_code == 200
    assert [item["id"] for item in peer_collaborators_after_grant.json()] == [collaborator_id]

    active_peer_manage_collaborators = client.post(
        f"/api/courses/{scope['course_id']}/collaborators",
        headers=peer_headers,
        json={"user_id": outside_teacher["id"]},
    )
    assert active_peer_manage_collaborators.status_code == 403
    assert active_peer_manage_collaborators.json()["detail"] == "Course collaborator management requires course owner role"

    peer_unit = client.post(
        f"/api/courses/{scope['course_id']}/units",
        headers=peer_headers,
        json={"title": "Peer Edited Unit", "position": 2, "status": "published"},
    )
    assert peer_unit.status_code == 201

    peer_assignment = client.post(
        f"/api/courses/{scope['course_id']}/units/{peer_unit.json()['id']}/assignments",
        headers=peer_headers,
        json={"title": "Peer Edited Assignment", "max_score": 20},
    )
    assert peer_assignment.status_code == 201

    peer_rule_update = client.patch(
        f"/api/points/assignments/{scope['assignment_id']}/rule",
        headers=peer_headers,
        json={"enabled": True, "points_per_score": 3, "max_points": 30},
    )
    assert peer_rule_update.status_code == 200
    assert peer_rule_update.json()["points_per_score"] == 3

    inactive = client.patch(
        f"/api/courses/{scope['course_id']}/collaborators/{collaborator_id}",
        headers=teacher_headers,
        json={"status": "inactive"},
    )
    assert inactive.status_code == 200
    assert inactive.json()["status"] == "inactive"

    inactive_audit = client.get(
        f"/api/admin/audit-logs?action=course.collaborator.update&resource_id={collaborator_id}",
        headers=admin_headers,
    )
    assert inactive_audit.status_code == 200
    assert inactive_audit.json()["total"] == 1
    assert inactive_audit.json()["items"][0]["snapshot_json"]["before"]["status"] == "active"
    assert inactive_audit.json()["items"][0]["snapshot_json"]["after"]["status"] == "inactive"

    peer_inactive_unit = client.post(
        f"/api/courses/{scope['course_id']}/units",
        headers=peer_headers,
        json={"title": "Peer Inactive Unit", "position": 3, "status": "published"},
    )
    assert peer_inactive_unit.status_code == 403
    assert peer_inactive_unit.json()["detail"] == "Course unit creation requires editor or content_editor role"

    peer_inactive_assignment = client.post(
        f"/api/courses/{scope['course_id']}/units/{scope['unit_id']}/assignments",
        headers=peer_headers,
        json={"title": "Peer Inactive Assignment", "max_score": 20},
    )
    assert peer_inactive_assignment.status_code == 403
    assert peer_inactive_assignment.json()["detail"] == "Assignment creation requires active editing collaborator role"

    peer_inactive_rule_update = client.patch(
        f"/api/points/assignments/{scope['assignment_id']}/rule",
        headers=peer_headers,
        json={"enabled": True, "points_per_score": 4, "max_points": 40},
    )
    assert peer_inactive_rule_update.status_code == 403
    assert peer_inactive_rule_update.json()["detail"] == "Assignment point rule requires editor or assessment_editor role"

    peer_inactive_collaborators = client.get(
        f"/api/courses/{scope['course_id']}/collaborators",
        headers=peer_headers,
    )
    assert peer_inactive_collaborators.status_code == 403
    assert peer_inactive_collaborators.json()["detail"] == "Course collaborators require active collaborator role"

    owner_active_collaborators = client.get(
        f"/api/courses/{scope['course_id']}/collaborators",
        headers=teacher_headers,
    )
    assert owner_active_collaborators.status_code == 200
    assert owner_active_collaborators.json() == []

    owner_all_collaborators = client.get(
        f"/api/courses/{scope['course_id']}/collaborators?status=all",
        headers=teacher_headers,
    )
    assert owner_all_collaborators.status_code == 200
    assert [item["id"] for item in owner_all_collaborators.json()] == [collaborator_id]

    reactivated = client.patch(
        f"/api/courses/{scope['course_id']}/collaborators/{collaborator_id}",
        headers=admin_headers,
        json={"status": "active"},
    )
    assert reactivated.status_code == 200
    assert reactivated.json()["status"] == "active"

    peer_reactivated_unit = client.post(
        f"/api/courses/{scope['course_id']}/units",
        headers=peer_headers,
        json={"title": "Peer Reactivated Unit", "position": 3, "status": "published"},
    )
    assert peer_reactivated_unit.status_code == 201

    _set_school_teacher_membership_status(peer_teacher["id"], scope["school_id"], "inactive")

    peer_school_inactive_collaborators = client.get(
        f"/api/courses/{scope['course_id']}/collaborators",
        headers=peer_headers,
    )
    assert peer_school_inactive_collaborators.status_code == 403
    assert peer_school_inactive_collaborators.json()["detail"] == "School role is outside current user scope"

    peer_school_inactive_assignment = client.post(
        f"/api/courses/{scope['course_id']}/units/{peer_reactivated_unit.json()['id']}/assignments",
        headers=peer_headers,
        json={"title": "Peer School Inactive Assignment", "max_score": 20},
    )
    assert peer_school_inactive_assignment.status_code == 403
    assert peer_school_inactive_assignment.json()["detail"] == "School role is outside current user scope"

    peer_school_inactive_rule_update = client.patch(
        f"/api/points/assignments/{scope['assignment_id']}/rule",
        headers=peer_headers,
        json={"enabled": True, "points_per_score": 5, "max_points": 50},
    )
    assert peer_school_inactive_rule_update.status_code == 403
    assert peer_school_inactive_rule_update.json()["detail"] == "School role is outside current user scope"

    owner_unit = client.post(
        f"/api/courses/{scope['course_id']}/units",
        headers=teacher_headers,
        json={"title": "Owner Edited Unit", "position": 4, "status": "published"},
    )
    assert owner_unit.status_code == 201

    owner_assignment = client.post(
        f"/api/courses/{scope['course_id']}/units/{owner_unit.json()['id']}/assignments",
        headers=teacher_headers,
        json={"title": "Owner Edited Assignment", "max_score": 20},
    )
    assert owner_assignment.status_code == 201

    admin_unit = client.post(
        f"/api/courses/{scope['course_id']}/units",
        headers=admin_headers,
        json={"title": "Admin Edited Unit", "position": 5, "status": "published"},
    )
    assert admin_unit.status_code == 201

    admin_assignment = client.post(
        f"/api/courses/{scope['course_id']}/units/{admin_unit.json()['id']}/assignments",
        headers=admin_headers,
        json={"title": "Admin Edited Assignment", "max_score": 20},
    )
    assert admin_assignment.status_code == 201

    admin_created_collaborator = client.post(
        f"/api/courses/{scope['course_id']}/collaborators",
        headers=admin_headers,
        json={"user_id": admin_managed_teacher["id"]},
    )
    assert admin_created_collaborator.status_code == 201
    assert admin_created_collaborator.json()["role"] == "editor"
    assert admin_created_collaborator.json()["status"] == "active"


def test_course_collaborator_roles_and_batch_updates_enforce_capability_and_class_boundaries(client):
    scope = _create_learning_scope(client)
    content_editor = _register_and_login(client, "scope_content_editor", "teacher")
    assessment_editor = _register_and_login(client, "scope_assessment_editor", "teacher")
    viewer = _register_and_login(client, "scope_course_viewer", "teacher")
    inactive_target = _register_and_login(client, "scope_inactive_batch_target", "teacher")
    outside_teacher = _register_and_login(client, "scope_batch_outside", "teacher")
    for target in (content_editor, assessment_editor, viewer, inactive_target):
        _grant_school_teacher_membership(target["id"], scope["school_id"])
    admin_token = _bootstrap_admin(client, "admin_course_collaborator_batch")

    owner_headers = _auth_header(scope["teacher"]["token"])
    content_headers = _auth_header(content_editor["token"])
    assessment_headers = _auth_header(assessment_editor["token"])
    viewer_headers = _auth_header(viewer["token"])
    batch_payload = {
        "items": [
            {
                "user_id": content_editor["id"],
                "role": "content_editor",
                "status": "active",
                "client_ref": "content",
            },
            {
                "user_id": assessment_editor["id"],
                "role": "assessment_editor",
                "status": "active",
                "client_ref": "assessment",
            },
            {"user_id": viewer["id"], "role": "viewer", "status": "active", "client_ref": "viewer"},
            {
                "user_id": outside_teacher["id"],
                "role": "editor",
                "status": "active",
                "client_ref": "outside",
            },
            {
                "user_id": scope["teacher"]["id"],
                "role": "editor",
                "status": "active",
                "client_ref": "owner",
            },
            {
                "user_id": inactive_target["id"],
                "role": "viewer",
                "status": "inactive",
                "client_ref": "missing-inactive",
            },
            {
                "user_id": content_editor["id"],
                "role": "editor",
                "status": "active",
                "client_ref": "duplicate-content",
            },
        ]
    }
    created = client.post(
        f"/api/courses/{scope['course_id']}/collaborators/batch",
        headers={**owner_headers, "X-Request-ID": "course-collaborator-batch-create"},
        json=batch_payload,
    )
    assert created.status_code == 200
    created_body = created.json()
    assert (
        created_body["created_count"],
        created_body["updated_count"],
        created_body["unchanged_count"],
        created_body["failed_count"],
    ) == (3, 0, 0, 4)
    assert [item["error_code"] for item in created_body["items"][3:]] == [
        "collaborator_not_eligible",
        "course_owner_conflict",
        "collaborator_not_found",
        "duplicate_item",
    ]
    collaborator_ids = {
        item["user_id"]: item["collaborator"]["id"]
        for item in created_body["items"][:3]
    }

    replay = client.post(
        f"/api/courses/{scope['course_id']}/collaborators/batch",
        headers={**owner_headers, "X-Request-ID": "course-collaborator-batch-replay"},
        json=batch_payload,
    )
    assert replay.status_code == 200
    assert replay.json()["created_count"] == 0
    assert replay.json()["updated_count"] == 0
    assert replay.json()["unchanged_count"] == 3
    assert replay.json()["failed_count"] == 4

    content_list = client.get(
        f"/api/courses/{scope['course_id']}/collaborators",
        headers=content_headers,
    )
    assert content_list.status_code == 200
    assert {item["role"] for item in content_list.json()} == {
        "content_editor",
        "assessment_editor",
        "viewer",
    }
    content_unit = client.post(
        f"/api/courses/{scope['course_id']}/units",
        headers=content_headers,
        json={"title": "Content Role Unit", "position": 2, "status": "published"},
    )
    assert content_unit.status_code == 201
    content_assignment = client.post(
        f"/api/courses/{scope['course_id']}/units/{content_unit.json()['id']}/assignments",
        headers=content_headers,
        json={"title": "Content Role Assignment", "max_score": 30},
    )
    assert content_assignment.status_code == 201
    content_rule_forbidden = client.patch(
        f"/api/points/assignments/{content_assignment.json()['id']}/rule",
        headers=content_headers,
        json={"enabled": True, "points_per_score": 2, "max_points": 20},
    )
    assert content_rule_forbidden.status_code == 403
    assert content_rule_forbidden.json()["detail"] == (
        "Assignment point rule requires editor or assessment_editor role"
    )

    assessment_unit_forbidden = client.post(
        f"/api/courses/{scope['course_id']}/units",
        headers=assessment_headers,
        json={"title": "Assessment Forbidden Unit", "position": 3, "status": "published"},
    )
    assert assessment_unit_forbidden.status_code == 403
    assessment_assignment = client.post(
        f"/api/courses/{scope['course_id']}/units/{scope['unit_id']}/assignments",
        headers=assessment_headers,
        json={"title": "Assessment Role Assignment", "max_score": 40},
    )
    assert assessment_assignment.status_code == 201
    assessment_rule = client.patch(
        f"/api/points/assignments/{assessment_assignment.json()['id']}/rule",
        headers=assessment_headers,
        json={"enabled": True, "points_per_score": 2, "max_points": 40},
    )
    assert assessment_rule.status_code == 200

    viewer_list = client.get(
        f"/api/courses/{scope['course_id']}/collaborators",
        headers=viewer_headers,
    )
    assert viewer_list.status_code == 200
    viewer_unit_forbidden = client.post(
        f"/api/courses/{scope['course_id']}/units",
        headers=viewer_headers,
        json={"title": "Viewer Forbidden Unit", "position": 3, "status": "published"},
    )
    assert viewer_unit_forbidden.status_code == 403
    viewer_assignment_forbidden = client.post(
        f"/api/courses/{scope['course_id']}/units/{scope['unit_id']}/assignments",
        headers=viewer_headers,
        json={"title": "Viewer Forbidden Assignment", "max_score": 20},
    )
    assert viewer_assignment_forbidden.status_code == 403
    viewer_members_forbidden = client.get(
        f"/api/classes/{scope['class_id']}/members",
        headers=viewer_headers,
    )
    assert viewer_members_forbidden.status_code == 403
    viewer_attach_forbidden = client.post(
        f"/api/courses/{scope['course_id']}/classes",
        headers=viewer_headers,
        json={"class_id": scope["class_id"]},
    )
    assert viewer_attach_forbidden.status_code == 403

    collaborator_manage_forbidden = client.post(
        f"/api/courses/{scope['course_id']}/collaborators/batch",
        headers=assessment_headers,
        json={"items": [{"user_id": inactive_target["id"], "role": "viewer", "status": "active"}]},
    )
    assert collaborator_manage_forbidden.status_code == 403

    viewer_promoted = client.patch(
        f"/api/courses/{scope['course_id']}/collaborators/{collaborator_ids[viewer['id']]}",
        headers=owner_headers,
        json={"role": "content_editor"},
    )
    assert viewer_promoted.status_code == 200
    assert viewer_promoted.json()["role"] == "content_editor"
    assert viewer_promoted.json()["status"] == "active"
    promoted_unit = client.post(
        f"/api/courses/{scope['course_id']}/units",
        headers=viewer_headers,
        json={"title": "Promoted Viewer Unit", "position": 3, "status": "published"},
    )
    assert promoted_unit.status_code == 201

    _set_school_teacher_membership_status(viewer["id"], scope["school_id"], "inactive")
    deactivated_after_scope_loss = client.patch(
        f"/api/courses/{scope['course_id']}/collaborators/{collaborator_ids[viewer['id']]}",
        headers=owner_headers,
        json={"status": "inactive"},
    )
    assert deactivated_after_scope_loss.status_code == 200
    blocked_reactivation = client.patch(
        f"/api/courses/{scope['course_id']}/collaborators/{collaborator_ids[viewer['id']]}",
        headers=owner_headers,
        json={"status": "active"},
    )
    assert blocked_reactivation.status_code == 422

    batch_audit = client.get(
        f"/api/admin/audit-logs?action=course.collaborator.batch_update&resource_id={scope['course_id']}",
        headers=_auth_header(admin_token),
    )
    assert batch_audit.status_code == 200
    assert batch_audit.json()["total"] == 2
    create_audit = next(
        item for item in batch_audit.json()["items"]
        if item["request_id"] == "course-collaborator-batch-create"
    )
    assert create_audit["snapshot_json"]["created_count"] == 3
    assert create_audit["snapshot_json"]["failed_count"] == 4
    assert create_audit["snapshot_json"]["partial_failure"] is True


def test_course_owner_transfer_rebinds_course_management_scope(client):
    scope = _create_learning_scope(client)
    successor = _register_and_login(client, "scope_owner_transfer_successor", "teacher")
    _grant_school_teacher_membership(successor["id"], scope["school_id"])
    peer_teacher = _register_and_login(client, "scope_owner_transfer_peer", "teacher")
    _grant_school_teacher_membership(peer_teacher["id"], scope["school_id"])
    outside_teacher = _register_and_login(client, "scope_owner_transfer_outside", "teacher")
    inactive_teacher = _register_and_login(client, "scope_owner_transfer_inactive", "teacher")
    _grant_school_teacher_membership(inactive_teacher["id"], scope["school_id"], status="inactive")
    disabled_teacher = _register_and_login(client, "scope_owner_transfer_disabled", "teacher")
    _grant_school_teacher_membership(disabled_teacher["id"], scope["school_id"])
    _set_user_status(disabled_teacher["id"], "disabled")
    school_admin_member = _register_and_login(client, "scope_owner_transfer_school_admin", "teacher")
    _grant_school_teacher_membership(school_admin_member["id"], scope["school_id"], role="admin")
    admin_token = _bootstrap_admin(client, "admin_course_owner_transfer")

    owner_headers = _auth_header(scope["teacher"]["token"])
    successor_headers = _auth_header(successor["token"])
    peer_headers = _auth_header(peer_teacher["token"])
    admin_headers = _auth_header(admin_token)

    collaborator = client.post(
        f"/api/courses/{scope['course_id']}/collaborators",
        headers=owner_headers,
        json={"user_id": successor["id"]},
    )
    assert collaborator.status_code == 201
    collaborator_id = collaborator.json()["id"]
    assert collaborator.json()["status"] == "active"

    peer_transfer = client.patch(
        f"/api/courses/{scope['course_id']}/owner",
        headers=peer_headers,
        json={"target_user_id": successor["id"]},
    )
    assert peer_transfer.status_code == 403
    assert peer_transfer.json()["detail"] == "Course owner transfer requires course owner role"

    student_transfer = client.patch(
        f"/api/courses/{scope['course_id']}/owner",
        headers=owner_headers,
        json={"target_user_id": scope["student"]["id"]},
    )
    assert student_transfer.status_code == 422
    assert student_transfer.json()["detail"] == "Course owner transfer target must be active school teacher/admin"

    outside_transfer = client.patch(
        f"/api/courses/{scope['course_id']}/owner",
        headers=owner_headers,
        json={"target_user_id": outside_teacher["id"]},
    )
    assert outside_transfer.status_code == 422
    assert outside_transfer.json()["detail"] == "Course owner transfer target must be active school teacher/admin"

    inactive_transfer = client.patch(
        f"/api/courses/{scope['course_id']}/owner",
        headers=owner_headers,
        json={"target_user_id": inactive_teacher["id"]},
    )
    assert inactive_transfer.status_code == 422
    assert inactive_transfer.json()["detail"] == "Course owner transfer target must be active school teacher/admin"

    disabled_transfer = client.patch(
        f"/api/courses/{scope['course_id']}/owner",
        headers=owner_headers,
        json={"target_user_id": disabled_teacher["id"]},
    )
    assert disabled_transfer.status_code == 422
    assert disabled_transfer.json()["detail"] == "Course owner transfer target must be active school teacher/admin"

    missing_transfer = client.patch(
        f"/api/courses/{scope['course_id']}/owner",
        headers=owner_headers,
        json={"target_user_id": 999999},
    )
    assert missing_transfer.status_code == 404
    assert missing_transfer.json()["detail"] == "Course owner transfer target not found"

    same_owner_transfer = client.patch(
        f"/api/courses/{scope['course_id']}/owner",
        headers=owner_headers,
        json={"target_user_id": scope["teacher"]["id"]},
    )
    assert same_owner_transfer.status_code == 409
    assert same_owner_transfer.json()["detail"] == "Course owner is already target user"

    transferred = client.patch(
        f"/api/courses/{scope['course_id']}/owner",
        headers=owner_headers,
        json={"target_user_id": successor["id"]},
    )
    assert transferred.status_code == 200
    assert transferred.json()["creator_user_id"] == successor["id"]

    transfer_audit = client.get(
        f"/api/admin/audit-logs?action=course.owner.transfer&resource_id={scope['course_id']}",
        headers=admin_headers,
    )
    assert transfer_audit.status_code == 200
    assert transfer_audit.json()["total"] == 1
    audit_snapshot = transfer_audit.json()["items"][0]["snapshot_json"]
    assert audit_snapshot["before"]["creator_user_id"] == scope["teacher"]["id"]
    assert audit_snapshot["after"]["creator_user_id"] == successor["id"]
    assert audit_snapshot["target_collaborator_before"]["id"] == collaborator_id
    assert audit_snapshot["target_collaborator_before"]["status"] == "active"
    assert audit_snapshot["target_collaborator_after"]["status"] == "inactive"

    successor_collaborators = client.get(
        f"/api/courses/{scope['course_id']}/collaborators",
        headers=successor_headers,
    )
    assert successor_collaborators.status_code == 200
    assert successor_collaborators.json() == []

    old_owner_unit = client.post(
        f"/api/courses/{scope['course_id']}/units",
        headers=owner_headers,
        json={"title": "Old Owner Unit", "position": 2, "status": "published"},
    )
    assert old_owner_unit.status_code == 403
    assert old_owner_unit.json()["detail"] == "Course unit creation requires editor or content_editor role"

    old_owner_collaborator_create = client.post(
        f"/api/courses/{scope['course_id']}/collaborators",
        headers=owner_headers,
        json={"user_id": peer_teacher["id"]},
    )
    assert old_owner_collaborator_create.status_code == 403
    assert old_owner_collaborator_create.json()["detail"] == "Course collaborator management requires course owner role"

    old_owner_rule_update = client.patch(
        f"/api/points/assignments/{scope['assignment_id']}/rule",
        headers=owner_headers,
        json={"enabled": True, "points_per_score": 2, "max_points": 20},
    )
    assert old_owner_rule_update.status_code == 403
    assert old_owner_rule_update.json()["detail"] == "Assignment point rule requires editor or assessment_editor role"

    successor_unit = client.post(
        f"/api/courses/{scope['course_id']}/units",
        headers=successor_headers,
        json={"title": "Successor Owner Unit", "position": 2, "status": "published"},
    )
    assert successor_unit.status_code == 201

    successor_collaborator_create = client.post(
        f"/api/courses/{scope['course_id']}/collaborators",
        headers=successor_headers,
        json={"user_id": peer_teacher["id"]},
    )
    assert successor_collaborator_create.status_code == 201
    assert successor_collaborator_create.json()["user_id"] == peer_teacher["id"]

    old_owner_transfer_back = client.patch(
        f"/api/courses/{scope['course_id']}/owner",
        headers=owner_headers,
        json={"target_user_id": scope["teacher"]["id"]},
    )
    assert old_owner_transfer_back.status_code == 403
    assert old_owner_transfer_back.json()["detail"] == "Course owner transfer requires course owner role"

    admin_transfer_back = client.patch(
        f"/api/courses/{scope['course_id']}/owner",
        headers=admin_headers,
        json={"target_user_id": scope["teacher"]["id"]},
    )
    assert admin_transfer_back.status_code == 200
    assert admin_transfer_back.json()["creator_user_id"] == scope["teacher"]["id"]

    restored_owner_unit = client.post(
        f"/api/courses/{scope['course_id']}/units",
        headers=owner_headers,
        json={"title": "Restored Owner Unit", "position": 3, "status": "published"},
    )
    assert restored_owner_unit.status_code == 201

    school_admin_owner_transfer = client.patch(
        f"/api/courses/{scope['course_id']}/owner",
        headers=owner_headers,
        json={"target_user_id": school_admin_member["id"]},
    )
    assert school_admin_owner_transfer.status_code == 200
    assert school_admin_owner_transfer.json()["creator_user_id"] == school_admin_member["id"]


def test_class_members_can_access_their_scoped_course_resources(client):
    scope = _create_learning_scope(client)
    student_headers = _auth_header(scope["student"]["token"])
    teacher_headers = _auth_header(scope["teacher"]["token"])
    now = datetime(2026, 7, 4, 12, 0, 0).isoformat()

    student_courses = client.get(f"/api/courses?class_id={scope['class_id']}", headers=student_headers)
    assert student_courses.status_code == 200
    assert [item["id"] for item in student_courses.json()] == [scope["course_id"]]

    learning_event = client.post(
        "/api/learning-events",
        headers=student_headers,
        json={
            "course_id": scope["course_id"],
            "class_id": scope["class_id"],
            "event_type": "visit",
            "payload": {"source": "access-control-test"},
            "occurred_at": now,
        },
    )
    assert learning_event.status_code == 201

    teacher_progress = client.get(
        f"/api/progress/users/{scope['student']['id']}?class_id={scope['class_id']}",
        headers=teacher_headers,
    )
    assert teacher_progress.status_code == 200

    class_knowledge = client.get(f"/api/classes/{scope['class_id']}/knowledge", headers=teacher_headers)
    assert class_knowledge.status_code == 200

    review = client.get(f"/api/assignments/{scope['assignment_id']}/review", headers=student_headers)
    assert review.status_code == 200
    review_body = review.json()
    assert review_body["assignment"]["id"] == scope["assignment_id"]
    assert review_body["submission"] is None
    assert review_body["can_submit"] is True
    assert review_body["read_only"] is False
    assert review_body["submit_block_reason"] is None

    closed_assignment = client.post(
        f"/api/courses/{scope['course_id']}/units/{scope['unit_id']}/assignments",
        headers=teacher_headers,
        json={"title": "Closed Empty Assignment", "max_score": 20, "status": "closed"},
    )
    assert closed_assignment.status_code == 201
    closed_review = client.get(f"/api/assignments/{closed_assignment.json()['id']}/review", headers=student_headers)
    assert closed_review.status_code == 200
    closed_review_body = closed_review.json()
    assert closed_review_body["submission"] is None
    assert closed_review_body["can_submit"] is False
    assert closed_review_body["read_only"] is True
    assert closed_review_body["submit_block_reason"] == "assignment_closed"

    archived_assignment = client.post(
        f"/api/courses/{scope['course_id']}/units/{scope['unit_id']}/assignments",
        headers=teacher_headers,
        json={"title": "Archived Empty Assignment", "max_score": 20, "status": "archived"},
    )
    assert archived_assignment.status_code == 201
    archived_review = client.get(f"/api/assignments/{archived_assignment.json()['id']}/review", headers=student_headers)
    assert archived_review.status_code == 200
    archived_review_body = archived_review.json()
    assert archived_review_body["submission"] is None
    assert archived_review_body["can_submit"] is False
    assert archived_review_body["read_only"] is True
    assert archived_review_body["submit_block_reason"] == "assignment_archived"


def test_students_only_see_published_course_content_and_active_assignments(client):
    teacher = _register_and_login(client, "visibility_teacher", "teacher")
    student = _register_and_login(client, "visibility_student", "student")
    teacher_headers = _auth_header(teacher["token"])
    student_headers = _auth_header(student["token"])

    school = client.post("/api/schools", headers=teacher_headers, json={"name": "Visibility School"})
    assert school.status_code == 201
    school_id = school.json()["id"]
    class_response = client.post(
        "/api/classes",
        headers=teacher_headers,
        json={"school_id": school_id, "name": "Visibility Class"},
    )
    assert class_response.status_code == 201
    class_id = class_response.json()["id"]
    join = client.post(f"/api/classes/{class_id}/join", headers=student_headers, json={"role": "student"})
    assert join.status_code == 201

    published_course = client.post(
        "/api/courses",
        headers=teacher_headers,
        json={"school_id": school_id, "title": "Published Visibility Course", "status": "published"},
    )
    assert published_course.status_code == 201
    published_course_id = published_course.json()["id"]
    draft_course = client.post(
        "/api/courses",
        headers=teacher_headers,
        json={"school_id": school_id, "title": "Draft Visibility Course", "status": "draft"},
    )
    assert draft_course.status_code == 201
    draft_course_id = draft_course.json()["id"]
    unattached_course = client.post(
        "/api/courses",
        headers=teacher_headers,
        json={"school_id": school_id, "title": "Unattached Published Course", "status": "published"},
    )
    assert unattached_course.status_code == 201

    for course_id in (published_course_id, draft_course_id):
        attach = client.post(
            f"/api/courses/{course_id}/classes",
            headers=teacher_headers,
            json={"class_id": class_id},
        )
        assert attach.status_code == 201

    published_unit = client.post(
        f"/api/courses/{published_course_id}/units",
        headers=teacher_headers,
        json={"title": "Visible Unit", "position": 1, "status": "published"},
    )
    assert published_unit.status_code == 201
    published_unit_id = published_unit.json()["id"]
    draft_unit = client.post(
        f"/api/courses/{published_course_id}/units",
        headers=teacher_headers,
        json={"title": "Hidden Draft Unit", "position": 2, "status": "draft"},
    )
    assert draft_unit.status_code == 201
    draft_unit_id = draft_unit.json()["id"]
    draft_course_unit = client.post(
        f"/api/courses/{draft_course_id}/units",
        headers=teacher_headers,
        json={"title": "Draft Course Unit", "position": 1, "status": "published"},
    )
    assert draft_course_unit.status_code == 201
    draft_course_unit_id = draft_course_unit.json()["id"]

    visible_assignment = client.post(
        f"/api/courses/{published_course_id}/units/{published_unit_id}/assignments",
        headers=teacher_headers,
        json={"title": "Visible Active Assignment", "max_score": 20, "status": "active"},
    )
    assert visible_assignment.status_code == 201
    visible_assignment_id = visible_assignment.json()["id"]
    closed_assignment = client.post(
        f"/api/courses/{published_course_id}/units/{published_unit_id}/assignments",
        headers=teacher_headers,
        json={"title": "Closed Assignment", "max_score": 20, "status": "closed"},
    )
    assert closed_assignment.status_code == 201
    closed_assignment_id = closed_assignment.json()["id"]
    hidden_unit_assignment = client.post(
        f"/api/courses/{published_course_id}/units/{draft_unit_id}/assignments",
        headers=teacher_headers,
        json={"title": "Hidden Unit Assignment", "max_score": 20, "status": "active"},
    )
    assert hidden_unit_assignment.status_code == 201
    hidden_unit_assignment_id = hidden_unit_assignment.json()["id"]
    draft_course_assignment = client.post(
        f"/api/courses/{draft_course_id}/units/{draft_course_unit_id}/assignments",
        headers=teacher_headers,
        json={"title": "Draft Course Assignment", "max_score": 20, "status": "active"},
    )
    assert draft_course_assignment.status_code == 201
    draft_course_assignment_id = draft_course_assignment.json()["id"]

    for path in ("/api/courses", f"/api/courses?school_id={school_id}", f"/api/courses?class_id={class_id}"):
        student_courses = client.get(path, headers=student_headers)
        assert student_courses.status_code == 200
        assert [item["id"] for item in student_courses.json()] == [published_course_id]

    teacher_class_courses = client.get(f"/api/courses?class_id={class_id}", headers=teacher_headers)
    assert teacher_class_courses.status_code == 200
    assert [item["id"] for item in teacher_class_courses.json()] == [published_course_id, draft_course_id]

    student_units = client.get(f"/api/courses/{published_course_id}/units", headers=student_headers)
    assert student_units.status_code == 200
    assert [item["id"] for item in student_units.json()] == [published_unit_id]
    teacher_units = client.get(f"/api/courses/{published_course_id}/units", headers=teacher_headers)
    assert teacher_units.status_code == 200
    assert [item["id"] for item in teacher_units.json()] == [published_unit_id, draft_unit_id]
    draft_course_units = client.get(f"/api/courses/{draft_course_id}/units", headers=student_headers)
    assert draft_course_units.status_code == 403
    assert draft_course_units.json()["detail"] == "Course is not published"

    student_assignments = client.get(f"/api/courses/{published_course_id}/assignments", headers=student_headers)
    assert student_assignments.status_code == 200
    assert [item["id"] for item in student_assignments.json()] == [visible_assignment_id]
    teacher_assignments = client.get(f"/api/courses/{published_course_id}/assignments", headers=teacher_headers)
    assert teacher_assignments.status_code == 200
    assert [item["id"] for item in teacher_assignments.json()] == [
        visible_assignment_id,
        closed_assignment_id,
        hidden_unit_assignment_id,
    ]

    visible_event = client.post(
        "/api/learning-events",
        headers=student_headers,
        json={"class_id": class_id, "assignment_id": visible_assignment_id, "event_type": "start", "payload": {}},
    )
    assert visible_event.status_code == 201
    hidden_unit_event = client.post(
        "/api/learning-events",
        headers=student_headers,
        json={"class_id": class_id, "assignment_id": hidden_unit_assignment_id, "event_type": "start", "payload": {}},
    )
    assert hidden_unit_event.status_code == 403
    assert hidden_unit_event.json()["detail"] == "Course unit is not published"
    closed_event = client.post(
        "/api/learning-events",
        headers=student_headers,
        json={"class_id": class_id, "assignment_id": closed_assignment_id, "event_type": "start", "payload": {}},
    )
    assert closed_event.status_code == 409
    assert closed_event.json()["detail"] == "Assignment is not active"
    draft_course_event = client.post(
        "/api/learning-events",
        headers=student_headers,
        json={"class_id": class_id, "assignment_id": draft_course_assignment_id, "event_type": "start", "payload": {}},
    )
    assert draft_course_event.status_code == 403
    assert draft_course_event.json()["detail"] == "Course is not published"

    hidden_unit_submission = client.post(
        f"/api/assignments/{hidden_unit_assignment_id}/submissions",
        headers=student_headers,
        json={"class_id": class_id, "content": {"answer": "hidden unit"}},
    )
    assert hidden_unit_submission.status_code == 403
    assert hidden_unit_submission.json()["detail"] == "Course unit is not published"
    closed_submission = client.post(
        f"/api/assignments/{closed_assignment_id}/submissions",
        headers=student_headers,
        json={"class_id": class_id, "content": {"answer": "closed"}},
    )
    assert closed_submission.status_code == 409
    assert closed_submission.json()["detail"] == "Assignment is not active"
    draft_course_submission = client.post(
        f"/api/assignments/{draft_course_assignment_id}/submissions",
        headers=student_headers,
        json={"class_id": class_id, "content": {"answer": "draft course"}},
    )
    assert draft_course_submission.status_code == 403
    assert draft_course_submission.json()["detail"] == "Course is not published"

    hidden_review = client.get(f"/api/assignments/{hidden_unit_assignment_id}/review", headers=student_headers)
    assert hidden_review.status_code == 403
    assert hidden_review.json()["detail"] == "Course unit is not published"
    closed_review = client.get(f"/api/assignments/{closed_assignment_id}/review", headers=student_headers)
    assert closed_review.status_code == 200
    assert closed_review.json()["submit_block_reason"] == "assignment_closed"
    draft_course_review = client.get(f"/api/assignments/{draft_course_assignment_id}/review", headers=student_headers)
    assert draft_course_review.status_code == 403
    assert draft_course_review.json()["detail"] == "Course is not published"


def test_student_personal_progress_and_knowledge_exclude_hidden_resource_history(client):
    teacher = _register_and_login(client, "visibility_history_teacher", "teacher")
    student = _register_and_login(client, "visibility_history_student", "student")
    teacher_headers = _auth_header(teacher["token"])
    student_headers = _auth_header(student["token"])

    school = client.post("/api/schools", headers=teacher_headers, json={"name": "Visibility History School"})
    assert school.status_code == 201
    school_id = school.json()["id"]
    class_response = client.post(
        "/api/classes",
        headers=teacher_headers,
        json={"school_id": school_id, "name": "Visibility History Class"},
    )
    assert class_response.status_code == 201
    class_id = class_response.json()["id"]
    join = client.post(f"/api/classes/{class_id}/join", headers=student_headers, json={"role": "student"})
    assert join.status_code == 201

    course = client.post(
        "/api/courses",
        headers=teacher_headers,
        json={"school_id": school_id, "title": "Visible History Course", "status": "published"},
    )
    assert course.status_code == 201
    course_id = course.json()["id"]
    soon_hidden_course = client.post(
        "/api/courses",
        headers=teacher_headers,
        json={"school_id": school_id, "title": "Soon Hidden Course", "status": "published"},
    )
    assert soon_hidden_course.status_code == 201
    soon_hidden_course_id = soon_hidden_course.json()["id"]
    for course_to_attach in (course_id, soon_hidden_course_id):
        attach = client.post(
            f"/api/courses/{course_to_attach}/classes",
            headers=teacher_headers,
            json={"class_id": class_id},
        )
        assert attach.status_code == 201

    visible_unit = client.post(
        f"/api/courses/{course_id}/units",
        headers=teacher_headers,
        json={"title": "Visible History Unit", "position": 1, "status": "published"},
    )
    assert visible_unit.status_code == 201
    hidden_unit = client.post(
        f"/api/courses/{course_id}/units",
        headers=teacher_headers,
        json={"title": "Soon Hidden Unit", "position": 2, "status": "published"},
    )
    assert hidden_unit.status_code == 201
    hidden_course_unit = client.post(
        f"/api/courses/{soon_hidden_course_id}/units",
        headers=teacher_headers,
        json={"title": "Soon Hidden Course Unit", "position": 1, "status": "published"},
    )
    assert hidden_course_unit.status_code == 201

    visible_assignment = client.post(
        f"/api/courses/{course_id}/units/{visible_unit.json()['id']}/assignments",
        headers=teacher_headers,
        json={"title": "Visible History Assignment", "max_score": 10, "status": "active"},
    )
    assert visible_assignment.status_code == 201
    visible_assignment_id = visible_assignment.json()["id"]
    hidden_assignment = client.post(
        f"/api/courses/{course_id}/units/{hidden_unit.json()['id']}/assignments",
        headers=teacher_headers,
        json={"title": "Soon Hidden Assignment", "max_score": 10, "status": "active"},
    )
    assert hidden_assignment.status_code == 201
    hidden_assignment_id = hidden_assignment.json()["id"]
    hidden_course_assignment = client.post(
        f"/api/courses/{soon_hidden_course_id}/units/{hidden_course_unit.json()['id']}/assignments",
        headers=teacher_headers,
        json={"title": "Soon Hidden Course Assignment", "max_score": 10, "status": "active"},
    )
    assert hidden_course_assignment.status_code == 201

    for assignment_id, score in ((visible_assignment_id, 7), (hidden_assignment_id, 9)):
        event = client.post(
            "/api/learning-events",
            headers=student_headers,
            json={"class_id": class_id, "assignment_id": assignment_id, "event_type": "start", "payload": {}},
        )
        assert event.status_code == 201
        submission = client.post(
            f"/api/assignments/{assignment_id}/submissions",
            headers=student_headers,
            json={"class_id": class_id, "content": {"answer": f"score {score}"}},
        )
        assert submission.status_code == 201
        grade = client.patch(
            f"/api/submissions/{submission.json()['id']}/grade",
            headers=teacher_headers,
            json={"score": score, "feedback": "graded"},
        )
        assert grade.status_code == 200

    snapshot_params = {
        "course_id": soon_hidden_course_id,
        "class_id": class_id,
        "from": "2026-01-01T00:00:00",
        "to": "2026-12-31T23:59:59",
        "granularity": "day",
    }
    hidden_course_snapshot = client.post(
        "/api/knowledge/me/snapshots",
        headers=student_headers,
        params=snapshot_params,
    )
    assert hidden_course_snapshot.status_code == 201

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        stored_unit = db.get(CourseUnit, hidden_unit.json()["id"])
        assert stored_unit is not None
        stored_unit.status = "draft"
        stored_course = db.get(Course, soon_hidden_course_id)
        assert stored_course is not None
        stored_course.status = "draft"
        db.commit()

    own_events = client.get("/api/learning-events", headers=student_headers)
    assert own_events.status_code == 200
    assert {item["assignment_id"] for item in own_events.json()} == {visible_assignment_id}

    progress = client.get(f"/api/progress/me?class_id={class_id}", headers=student_headers)
    assert progress.status_code == 200
    assert progress.json()["submitted_assignments"] == 1
    assert progress.json()["graded_assignments"] == 1
    assert progress.json()["learning_events"] == 2
    assert progress.json()["completed_events"] == 0
    assert progress.json()["total_points"] == 7

    teacher_progress = client.get(
        f"/api/progress/users/{student['id']}?class_id={class_id}",
        headers=teacher_headers,
    )
    assert teacher_progress.status_code == 200
    assert teacher_progress.json()["submitted_assignments"] == 1
    assert teacher_progress.json()["graded_assignments"] == 1
    assert teacher_progress.json()["learning_events"] == 2
    assert teacher_progress.json()["completed_events"] == 0
    assert teacher_progress.json()["total_points"] == 7

    knowledge = client.get(f"/api/knowledge/me?class_id={class_id}&course_id={course_id}", headers=student_headers)
    assert knowledge.status_code == 200
    assert knowledge.json()["assignment_count"] == 1
    assert knowledge.json()["submitted_assignments"] == 1
    assert knowledge.json()["graded_assignments"] == 1
    assert knowledge.json()["total_events"] == 2
    assert knowledge.json()["complete_events"] == 0
    assert knowledge.json()["score_total"] == 7
    assert knowledge.json()["max_score_total"] == 10
    assert knowledge.json()["total_points"] == 7

    visible_snapshot = client.post(
        "/api/knowledge/me/snapshots",
        headers=student_headers,
        params={
            "course_id": course_id,
            "class_id": class_id,
            "from": "2026-01-01T00:00:00",
            "to": "2026-12-31T23:59:59",
            "granularity": "day",
        },
    )
    assert visible_snapshot.status_code == 201
    assert visible_snapshot.json()["assignment_count"] == 1
    assert visible_snapshot.json()["total_points"] == 7

    hidden_course_knowledge = client.get(
        f"/api/knowledge/me?class_id={class_id}&course_id={soon_hidden_course_id}",
        headers=student_headers,
    )
    assert hidden_course_knowledge.status_code == 403
    assert hidden_course_knowledge.json()["detail"] == "Course is not published"
    hidden_course_snapshot_retry = client.post(
        "/api/knowledge/me/snapshots",
        headers=student_headers,
        params=snapshot_params,
    )
    assert hidden_course_snapshot_retry.status_code == 403
    assert hidden_course_snapshot_retry.json()["detail"] == "Course is not published"

    snapshot_list = client.get(
        "/api/knowledge/me/snapshots",
        headers=student_headers,
        params={"class_id": class_id, "limit": 10},
    )
    assert snapshot_list.status_code == 200
    assert [item["course_id"] for item in snapshot_list.json()["items"]] == [course_id]

    with session_factory() as db:
        run = knowledge_snapshot_runs.rebuild_periodic_knowledge_snapshots(
            db,
            granularity="day",
            reference_date=datetime(2026, 7, 6),
            trigger_source="pytest",
        )
        assert run.status == "success"
        assert run.class_snapshot_count == 2
        assert run.user_snapshot_count == 1
        hidden_user_snapshot = db.scalar(
            select(UserKnowledgeSnapshot).where(
                UserKnowledgeSnapshot.user_id == student["id"],
                UserKnowledgeSnapshot.course_id == soon_hidden_course_id,
                UserKnowledgeSnapshot.period_start == run.period_start,
                UserKnowledgeSnapshot.period_end == run.period_end,
            )
        )
        assert hidden_user_snapshot is None
