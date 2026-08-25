from app.core.config import get_settings
from app.db.session import get_session_factory
from app.models import (
    ClassGroup,
    ClassMembership,
    CourseClass,
    CourseEnrollment,
    CourseJoinRequest,
    SchoolMembership,
    User,
)
from sqlalchemy import select


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Cookie": ""}


def _bootstrap_admin(client, username: str) -> dict:
    password = "Course-enrollment-admin-123"
    created = client.post(
        "/api/admin/bootstrap",
        json={"username": username, "display_name": username.title(), "password": password},
    )
    assert created.status_code == 201, created.json()
    logged_in = client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    assert logged_in.status_code == 200, logged_in.json()
    return {"id": created.json()["id"], "token": logged_in.json()["access_token"]}


def _register(client, username: str, role: str) -> dict:
    password = "Course-enrollment-user-123"
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
    logged_in = client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    assert logged_in.status_code == 200, logged_in.json()
    return {"id": created.json()["id"], "token": logged_in.json()["access_token"]}


def _create_school(client, teacher: dict, name: str) -> int:
    response = client.post(
        "/api/schools",
        headers=_auth(teacher["token"]),
        json={"name": name, "region": "Shanghai"},
    )
    assert response.status_code == 201, response.json()
    return response.json()["id"]


def _grant_school_teacher(user_id: int, school_id: int) -> None:
    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        db.add(
            SchoolMembership(
                school_id=school_id,
                user_id=user_id,
                role="teacher",
                status="active",
            )
        )
        db.commit()


def _create_homeroom(client, teacher: dict, school_id: int, name: str) -> int:
    response = client.post(
        "/api/classes",
        headers=_auth(teacher["token"]),
        json={
            "school_id": school_id,
            "name": name,
            "grade": "10",
            "term": "2026A",
        },
    )
    assert response.status_code == 201, response.json()
    return response.json()["id"]


def _join_homeroom(client, student: dict, class_id: int) -> int:
    response = client.post(
        f"/api/classes/{class_id}/join",
        headers=_auth(student["token"]),
        json={"role": "student"},
    )
    assert response.status_code == 201, response.json()
    return response.json()["id"]


def _course_payload(
    *,
    school_id: int,
    title: str,
    collaborators: list[int] | None = None,
    admission_mode: str = "open",
    admission_classes: list[int] | None = None,
) -> dict:
    return {
        "school_id": school_id,
        "title": title,
        "summary": f"{title} summary",
        "academic_year": "2026—2027",
        "schedule_text": "Thursday 14:00—15:40",
        "total_hours": 36,
        "galaxy_key": "englab",
        "subject_key": "physics",
        "admission_mode": admission_mode,
        "collaborator_user_ids": collaborators or [],
        "admission_class_ids": admission_classes or [],
    }


def _create_approved_course(
    client,
    *,
    teacher: dict,
    admin: dict,
    payload: dict,
) -> dict:
    created = client.post(
        "/api/v1/courses",
        headers=_auth(teacher["token"]),
        json=payload,
    )
    assert created.status_code == 201, created.json()
    body = created.json()
    submitted = client.post(
        f"/api/v1/courses/{body['id']}/information-revisions/"
        f"{body['information_revision']['id']}/submit",
        headers=_auth(teacher["token"]),
    )
    assert submitted.status_code == 200, submitted.json()
    approved = client.patch(
        f"/api/v1/admin/course-information-revisions/"
        f"{body['information_revision']['id']}",
        headers=_auth(admin["token"]),
        json={"status": "approved", "note": "approved for enrollment tests"},
    )
    assert approved.status_code == 200, approved.json()
    return {
        "id": body["id"],
        "code": approved.json()["course_code"],
        "internal_class_id": approved.json()["internal_class_id"],
    }


def _set_membership_status(membership_id: int, status: str) -> None:
    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        membership = db.get(ClassMembership, membership_id)
        assert membership is not None
        membership.status = status
        db.commit()


def _set_user_status(user_id: int, status: str) -> None:
    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        user = db.get(User, user_id)
        assert user is not None
        user.status = status
        db.commit()


def test_open_course_request_approval_and_self_leave_preserve_history(client) -> None:
    admin = _bootstrap_admin(client, "enrollment_open_admin")
    owner = _register(client, "enrollment_open_owner", "teacher")
    peer = _register(client, "enrollment_open_peer", "teacher")
    student = _register(client, "enrollment_open_student", "student")
    other_student = _register(client, "enrollment_open_other", "student")
    school_id = _create_school(client, owner, "Enrollment Open School")
    _grant_school_teacher(peer["id"], school_id)
    course = _create_approved_course(
        client,
        teacher=owner,
        admin=admin,
        payload=_course_payload(
            school_id=school_id,
            title="Open Mechanics Course",
            collaborators=[peer["id"]],
        ),
    )

    discovered = client.get(
        f"/api/v1/courses/by-code/{course['code'].lower()}",
        headers=_auth(student["token"]),
    )
    assert discovered.status_code == 200, discovered.json()
    assert discovered.json()["can_request"] is True
    assert discovered.json()["eligibility_reason"] == "eligible"
    assert discovered.json()["eligible_source_classes"] == []
    assert {item["user_id"] for item in discovered.json()["teachers"]} == {
        owner["id"],
        peer["id"],
    }

    created = client.post(
        f"/api/v1/courses/{course['id']}/join-requests",
        headers=_auth(student["token"]),
        json={"message": "I want to join"},
    )
    assert created.status_code == 201, created.json()
    assert created.json()["status"] == "pending"
    assert created.json()["source_class_name"] == "未关联班级"
    duplicate = client.post(
        f"/api/v1/courses/{course['id']}/join-requests",
        headers=_auth(student["token"]),
        json={"message": "duplicate request"},
    )
    assert duplicate.status_code == 201, duplicate.json()
    assert duplicate.json()["id"] == created.json()["id"]

    forbidden_list = client.get(
        f"/api/v1/courses/{course['id']}/join-requests",
        headers=_auth(student["token"]),
    )
    assert forbidden_list.status_code == 403, forbidden_list.json()
    peer_queue = client.get(
        f"/api/v1/courses/{course['id']}/join-requests",
        headers=_auth(peer["token"]),
    )
    assert peer_queue.status_code == 200, peer_queue.json()
    assert peer_queue.json()["total"] == 1

    approved = client.patch(
        f"/api/v1/courses/{course['id']}/join-requests/{created.json()['id']}",
        headers=_auth(peer["token"]),
        json={"status": "approved", "note": "welcome"},
    )
    assert approved.status_code == 200, approved.json()
    assert approved.json()["status"] == "approved"
    repeat_review = client.patch(
        f"/api/v1/courses/{course['id']}/join-requests/{created.json()['id']}",
        headers=_auth(owner["token"]),
        json={"status": "approved"},
    )
    assert repeat_review.status_code == 409, repeat_review.json()

    roster = client.get(
        f"/api/v1/courses/{course['id']}/enrollments",
        headers=_auth(owner["token"]),
    )
    assert roster.status_code == 200, roster.json()
    assert roster.json()["total"] == 1
    enrollment = roster.json()["items"][0]
    assert enrollment["student_id"] == student["id"]
    assert enrollment["source"] == "request"
    assert enrollment["source_class_name"] == "未关联班级"

    visible_courses = client.get("/api/courses", headers=_auth(student["token"]))
    assert visible_courses.status_code == 200, visible_courses.json()
    assert course["id"] in {item["id"] for item in visible_courses.json()}
    forbidden_other_leave = client.patch(
        f"/api/v1/courses/{course['id']}/enrollments/{enrollment['id']}",
        headers=_auth(other_student["token"]),
        json={"status": "left"},
    )
    assert forbidden_other_leave.status_code == 403, forbidden_other_leave.json()
    left = client.patch(
        f"/api/v1/courses/{course['id']}/enrollments/{enrollment['id']}",
        headers=_auth(student["token"]),
        json={"status": "left", "note": "schedule conflict"},
    )
    assert left.status_code == 200, left.json()
    assert left.json()["status"] == "left"

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        persisted = db.get(CourseEnrollment, enrollment["id"])
        assert persisted is not None and persisted.status == "left"
        request_history = list(
            db.scalars(
                select(CourseJoinRequest).where(
                    CourseJoinRequest.course_id == course["id"],
                    CourseJoinRequest.student_id == student["id"],
                )
            ).all()
        )
        assert len(request_history) == 1
        internal_membership = db.scalar(
            select(ClassMembership).where(
                ClassMembership.class_id == course["internal_class_id"],
                ClassMembership.user_id == student["id"],
                ClassMembership.role == "student",
            )
        )
        assert internal_membership is not None
        assert internal_membership.status == "inactive"


def test_restricted_course_rechecks_class_eligibility_and_allows_reapply(client) -> None:
    admin = _bootstrap_admin(client, "enrollment_restricted_admin")
    owner = _register(client, "enrollment_restricted_owner", "teacher")
    outsider_teacher = _register(client, "enrollment_restricted_teacher", "teacher")
    eligible = _register(client, "enrollment_restricted_student", "student")
    outsider = _register(client, "enrollment_restricted_outsider", "student")
    school_id = _create_school(client, owner, "Enrollment Restricted School")
    _grant_school_teacher(outsider_teacher["id"], school_id)
    allowed_class = _create_homeroom(client, owner, school_id, "Allowed Homeroom")
    other_class = _create_homeroom(client, owner, school_id, "Other Homeroom")
    eligible_membership_id = _join_homeroom(client, eligible, allowed_class)
    _join_homeroom(client, outsider, other_class)
    course = _create_approved_course(
        client,
        teacher=owner,
        admin=admin,
        payload=_course_payload(
            school_id=school_id,
            title="Restricted Physics Course",
            admission_mode="class_restricted",
            admission_classes=[allowed_class],
        ),
    )

    outsider_view = client.get(
        f"/api/v1/courses/by-code/{course['code']}",
        headers=_auth(outsider["token"]),
    )
    assert outsider_view.status_code == 200, outsider_view.json()
    assert outsider_view.json()["can_request"] is False
    assert outsider_view.json()["eligibility_reason"] == "class_not_eligible"
    outsider_request = client.post(
        f"/api/v1/courses/{course['id']}/join-requests",
        headers=_auth(outsider["token"]),
        json={},
    )
    assert outsider_request.status_code == 403, outsider_request.json()

    request_one = client.post(
        f"/api/v1/courses/{course['id']}/join-requests",
        headers=_auth(eligible["token"]),
        json={},
    )
    assert request_one.status_code == 201, request_one.json()
    assert request_one.json()["source_class_id"] == allowed_class
    outsider_review = client.patch(
        f"/api/v1/courses/{course['id']}/join-requests/{request_one.json()['id']}",
        headers=_auth(outsider_teacher["token"]),
        json={"status": "approved"},
    )
    assert outsider_review.status_code == 403, outsider_review.json()

    _set_membership_status(eligible_membership_id, "inactive")
    stale_approval = client.patch(
        f"/api/v1/courses/{course['id']}/join-requests/{request_one.json()['id']}",
        headers=_auth(owner["token"]),
        json={"status": "approved"},
    )
    assert stale_approval.status_code == 409, stale_approval.json()
    rejected = client.patch(
        f"/api/v1/courses/{course['id']}/join-requests/{request_one.json()['id']}",
        headers=_auth(owner["token"]),
        json={"status": "rejected", "note": "class membership inactive"},
    )
    assert rejected.status_code == 200, rejected.json()
    assert rejected.json()["status"] == "rejected"

    _set_membership_status(eligible_membership_id, "active")
    request_two = client.post(
        f"/api/v1/courses/{course['id']}/join-requests",
        headers=_auth(eligible["token"]),
        json={"source_class_id": allowed_class},
    )
    assert request_two.status_code == 201, request_two.json()
    assert request_two.json()["request_number"] == 2
    approved = client.patch(
        f"/api/v1/courses/{course['id']}/join-requests/{request_two.json()['id']}",
        headers=_auth(admin["token"]),
        json={"status": "approved", "note": "admin fallback"},
    )
    assert approved.status_code == 200, approved.json()
    assert approved.json()["status"] == "approved"

    roster = client.get(
        f"/api/v1/courses/{course['id']}/enrollments",
        headers=_auth(admin["token"]),
    )
    assert roster.status_code == 200, roster.json()
    assert roster.json()["items"][0]["source_class_id"] == allowed_class
    assert roster.json()["items"][0]["source_class_name"] == "Allowed Homeroom"


def test_class_batch_reports_each_student_and_does_not_restore_left_enrollment(client) -> None:
    admin = _bootstrap_admin(client, "enrollment_batch_admin")
    owner = _register(client, "enrollment_batch_owner", "teacher")
    first = _register(client, "enrollment_batch_first", "student")
    already = _register(client, "enrollment_batch_already", "student")
    left_student = _register(client, "enrollment_batch_left", "student")
    inactive_member = _register(client, "enrollment_batch_inactive_member", "student")
    inactive_user = _register(client, "enrollment_batch_inactive_user", "student")
    school_id = _create_school(client, owner, "Enrollment Batch School")
    homeroom_id = _create_homeroom(client, owner, school_id, "Batch Homeroom")
    _join_homeroom(client, first, homeroom_id)
    _join_homeroom(client, already, homeroom_id)
    _join_homeroom(client, left_student, homeroom_id)
    inactive_membership_id = _join_homeroom(client, inactive_member, homeroom_id)
    _join_homeroom(client, inactive_user, homeroom_id)
    _set_membership_status(inactive_membership_id, "inactive")
    _set_user_status(inactive_user["id"], "inactive")
    course = _create_approved_course(
        client,
        teacher=owner,
        admin=admin,
        payload=_course_payload(
            school_id=school_id,
            title="Batch Enrollment Course",
            admission_mode="class_restricted",
            admission_classes=[homeroom_id],
        ),
    )

    first_request = client.post(
        f"/api/v1/courses/{course['id']}/join-requests",
        headers=_auth(first["token"]),
        json={},
    )
    assert first_request.status_code == 201, first_request.json()
    for student in (already, left_student):
        request = client.post(
            f"/api/v1/courses/{course['id']}/join-requests",
            headers=_auth(student["token"]),
            json={},
        )
        assert request.status_code == 201, request.json()
        approved = client.patch(
            f"/api/v1/courses/{course['id']}/join-requests/{request.json()['id']}",
            headers=_auth(owner["token"]),
            json={"status": "approved"},
        )
        assert approved.status_code == 200, approved.json()

    before = client.get(
        f"/api/v1/courses/{course['id']}/enrollments",
        headers=_auth(owner["token"]),
    )
    assert before.status_code == 200, before.json()
    left_enrollment = next(
        item for item in before.json()["items"] if item["student_id"] == left_student["id"]
    )
    removed = client.patch(
        f"/api/v1/courses/{course['id']}/enrollments/{left_enrollment['id']}",
        headers=_auth(owner["token"]),
        json={"status": "left", "note": "removed before batch"},
    )
    assert removed.status_code == 200, removed.json()

    batch = client.post(
        f"/api/v1/courses/{course['id']}/enrollments/batch",
        headers=_auth(owner["token"]),
        json={"class_id": homeroom_id},
    )
    assert batch.status_code == 200, batch.json()
    body = batch.json()
    assert body["created_count"] == 1
    assert body["already_enrolled_count"] == 1
    assert body["previously_left_count"] == 1
    assert body["ineligible_count"] == 2
    outcomes = {item["student_id"]: item["outcome"] for item in body["items"]}
    assert outcomes == {
        first["id"]: "created",
        already["id"]: "already_enrolled",
        left_student["id"]: "previously_left",
        inactive_member["id"]: "student_not_eligible",
        inactive_user["id"]: "student_not_eligible",
    }
    first_result = next(item for item in body["items"] if item["student_id"] == first["id"])
    assert first_result["join_request_status"] == "approved"

    pending_queue = client.get(
        f"/api/v1/courses/{course['id']}/join-requests",
        headers=_auth(owner["token"]),
    )
    assert pending_queue.status_code == 200, pending_queue.json()
    assert pending_queue.json()["total"] == 0
    left_history = client.get(
        f"/api/v1/courses/{course['id']}/enrollments",
        headers=_auth(owner["token"]),
        params={"status": "left"},
    )
    assert left_history.status_code == 200, left_history.json()
    assert [item["student_id"] for item in left_history.json()["items"]] == [
        left_student["id"]
    ]


def test_one_student_can_join_multiple_courses(client) -> None:
    admin = _bootstrap_admin(client, "enrollment_multi_admin")
    owner = _register(client, "enrollment_multi_owner", "teacher")
    student = _register(client, "enrollment_multi_student", "student")
    school_id = _create_school(client, owner, "Enrollment Multiple Courses School")
    courses = [
        _create_approved_course(
            client,
            teacher=owner,
            admin=admin,
            payload=_course_payload(school_id=school_id, title=title),
        )
        for title in ("Multiple Course A", "Multiple Course B")
    ]
    enrollment_ids = []
    for course in courses:
        requested = client.post(
            f"/api/v1/courses/{course['id']}/join-requests",
            headers=_auth(student["token"]),
            json={},
        )
        assert requested.status_code == 201, requested.json()
        approved = client.patch(
            f"/api/v1/courses/{course['id']}/join-requests/{requested.json()['id']}",
            headers=_auth(owner["token"]),
            json={"status": "approved"},
        )
        assert approved.status_code == 200, approved.json()
        roster = client.get(
            f"/api/v1/courses/{course['id']}/enrollments",
            headers=_auth(owner["token"]),
        )
        assert roster.status_code == 200, roster.json()
        enrollment_ids.append(roster.json()["items"][0]["id"])

    assert len(set(enrollment_ids)) == 2
    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        enrollments = list(
            db.scalars(
                select(CourseEnrollment).where(CourseEnrollment.student_id == student["id"])
            ).all()
        )
        assert len(enrollments) == 2
        internal_class_ids = set(
            db.scalars(
                select(ClassGroup.id)
                .join(CourseClass, CourseClass.class_id == ClassGroup.id)
                .where(
                    CourseClass.course_id.in_([item["id"] for item in courses]),
                    ClassGroup.kind == "course_cohort",
                )
            ).all()
        )
        memberships = list(
            db.scalars(
                select(ClassMembership).where(
                    ClassMembership.class_id.in_(internal_class_ids),
                    ClassMembership.user_id == student["id"],
                    ClassMembership.status == "active",
                )
            ).all()
        )
        assert len(memberships) == 2
