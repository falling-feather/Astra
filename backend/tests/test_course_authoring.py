from sqlalchemy import func, select

from app.core.config import get_settings
from app.db.session import get_session_factory
from app.models import (
    ClassGroup,
    Course,
    CourseAdmissionClass,
    CourseClass,
    CourseCollaborator,
    CourseEnrollment,
    CourseInformationRevision,
    CourseJoinRequest,
    SchoolMembership,
)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Cookie": ""}


def _register_teacher(client, username: str) -> dict:
    password = "Authoring-password-123"
    registered = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "display_name": username.replace("_", " ").title(),
            "password": password,
            "role": "teacher",
        },
    )
    assert registered.status_code == 201, registered.json()
    logged_in = client.post("/api/auth/login", json={"username": username, "password": password})
    assert logged_in.status_code == 200, logged_in.json()
    token = logged_in.json()["access_token"]
    me = client.get("/api/users/me", headers=_auth(token))
    assert me.status_code == 200, me.json()
    return {"id": me.json()["id"], "token": token}


def _register_student(client, username: str) -> dict:
    password = "Authoring-student-password-123"
    registered = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "display_name": username.replace("_", " ").title(),
            "password": password,
            "role": "student",
        },
    )
    assert registered.status_code == 201, registered.json()
    logged_in = client.post("/api/auth/login", json={"username": username, "password": password})
    assert logged_in.status_code == 200, logged_in.json()
    return {"id": registered.json()["id"], "token": logged_in.json()["access_token"]}


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


def _draft_payload(
    *,
    school_id: int,
    title: str,
    collaborator_user_ids: list[int] | None = None,
    admission_mode: str = "open",
    admission_class_ids: list[int] | None = None,
) -> dict:
    return {
        "school_id": school_id,
        "title": title,
        "summary": "A shared course draft",
        "academic_year": "2026—2027",
        "schedule_text": "Tuesday 14:00—15:40",
        "total_hours": 32,
        "galaxy_key": "Astra_Core",
        "subject_key": "Physics_Mechanics",
        "admission_mode": admission_mode,
        "collaborator_user_ids": collaborator_user_ids or [],
        "admission_class_ids": admission_class_ids or [],
    }


def test_teacher_creates_shared_course_draft_and_submits_revision(client) -> None:
    owner = _register_teacher(client, "authoring_owner")
    peer = _register_teacher(client, "authoring_peer")
    outside = _register_teacher(client, "authoring_outside")
    school_id = _create_school(client, owner, "Authoring Shared School")
    _grant_school_teacher(peer["id"], school_id)
    class_response = client.post(
        "/api/classes",
        headers=_auth(owner["token"]),
        json={
            "school_id": school_id,
            "name": "Authoring Homeroom",
            "grade": "10",
            "term": "2026A",
        },
    )
    assert class_response.status_code == 201, class_response.json()
    class_id = class_response.json()["id"]

    options = client.get(
        "/api/v1/courses/authoring-options",
        headers=_auth(owner["token"]),
        params={"school_id": school_id},
    )
    assert options.status_code == 200, options.json()
    assert [item["user_id"] for item in options.json()["teachers"]] == [peer["id"]]
    assert options.json()["homerooms"] == [
        {
            "class_id": class_id,
            "name": "Authoring Homeroom",
            "grade": "10",
            "term": "2026A",
        }
    ]
    assert options.json()["admission_modes"] == ["open", "class_restricted"]

    created = client.post(
        "/api/v1/courses",
        headers=_auth(owner["token"]),
        json=_draft_payload(
            school_id=school_id,
            title="Shared Physics Course",
            collaborator_user_ids=[peer["id"]],
            admission_mode="class_restricted",
            admission_class_ids=[class_id],
        ),
    )
    assert created.status_code == 201, created.json()
    draft = created.json()
    course_id = draft["id"]
    revision_id = draft["information_revision"]["id"]
    assert draft["status"] == "draft"
    assert draft["course_code"] is None
    assert draft["current_information_revision_id"] is None
    assert draft["galaxy_key"] == "astra-core"
    assert draft["subject_key"] == "physics-mechanics"
    assert draft["admission_mode"] == "class_restricted"
    assert draft["information_revision"]["status"] == "draft"
    assert draft["information_revision"]["teacher_ids_snapshot"] == [owner["id"], peer["id"]]
    assert [item["user_id"] for item in draft["teachers"]] == [owner["id"], peer["id"]]
    assert draft["teachers"][0]["is_creator"] is True
    assert draft["teachers"][1]["is_creator"] is False
    assert draft["admission_classes"] == [
        {"class_id": class_id, "name": "Authoring Homeroom", "status": "active"}
    ]

    peer_list = client.get(
        "/api/v1/courses",
        headers=_auth(peer["token"]),
        params={"school_id": school_id},
    )
    assert peer_list.status_code == 200, peer_list.json()
    assert [item["id"] for item in peer_list.json()] == [course_id]
    peer_detail = client.get(f"/api/v1/courses/{course_id}", headers=_auth(peer["token"]))
    assert peer_detail.status_code == 200, peer_detail.json()
    outside_detail = client.get(f"/api/v1/courses/{course_id}", headers=_auth(outside["token"]))
    assert outside_detail.status_code == 403, outside_detail.json()

    cross_subject_unit = client.post(
        f"/api/courses/{course_id}/units",
        headers=_auth(peer["token"]),
        json={
            "activity_key": "engineering.robot-arm-ik",
            "title": "Cross-subject activity reference",
            "position": 1,
            "status": "draft",
        },
    )
    assert cross_subject_unit.status_code == 201, cross_subject_unit.json()

    submitted = client.post(
        f"/api/v1/courses/{course_id}/information-revisions/{revision_id}/submit",
        headers=_auth(peer["token"]),
    )
    assert submitted.status_code == 200, submitted.json()
    assert submitted.json()["information_revision"]["status"] == "submitted"
    assert submitted.json()["information_revision"]["submitted_at"] is not None
    assert submitted.json()["status"] == "draft"
    assert submitted.json()["course_code"] is None

    repeated_submit = client.post(
        f"/api/v1/courses/{course_id}/information-revisions/{revision_id}/submit",
        headers=_auth(owner["token"]),
    )
    assert repeated_submit.status_code == 409, repeated_submit.json()

    teacher_publish = client.patch(
        f"/api/courses/{course_id}/status",
        headers=_auth(owner["token"]),
        json={
            "expected_status": "draft",
            "status": "published",
            "reason": "Teacher must not self-activate a reviewed course",
        },
    )
    assert teacher_publish.status_code == 403, teacher_publish.json()

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        course = db.get(Course, course_id)
        assert course is not None
        assert course.status == "draft"
        assert course.course_code is None
        assert course.current_information_revision_id is None
        assert db.scalar(
            select(func.count()).select_from(CourseClass).where(CourseClass.course_id == course_id)
        ) == 0
        assert db.scalar(
            select(func.count())
            .select_from(ClassGroup)
            .where(ClassGroup.school_id == school_id, ClassGroup.kind == "course_cohort")
        ) == 0
        assert db.scalar(
            select(func.count())
            .select_from(CourseCollaborator)
            .where(CourseCollaborator.course_id == course_id)
        ) == 1
        assert db.scalar(
            select(func.count())
            .select_from(CourseAdmissionClass)
            .where(CourseAdmissionClass.course_id == course_id)
        ) == 1
        assert db.scalar(
            select(func.count())
            .select_from(CourseInformationRevision)
            .where(CourseInformationRevision.course_id == course_id)
        ) == 1
        assert db.scalar(
            select(func.count())
            .select_from(CourseEnrollment)
            .where(CourseEnrollment.course_id == course_id)
        ) == 0
        assert db.scalar(
            select(func.count())
            .select_from(CourseJoinRequest)
            .where(CourseJoinRequest.course_id == course_id)
        ) == 0


def test_authoring_supports_many_courses_and_rejects_cross_school_teachers(client) -> None:
    owner = _register_teacher(client, "authoring_multi_owner")
    peer = _register_teacher(client, "authoring_multi_peer")
    outsider = _register_teacher(client, "authoring_cross_school")
    student = _register_student(client, "authoring_student")
    school_id = _create_school(client, owner, "Authoring Primary School")
    other_school_id = _create_school(client, outsider, "Authoring Other School")
    assert other_school_id != school_id

    cross_school = client.post(
        "/api/v1/courses",
        headers=_auth(owner["token"]),
        json=_draft_payload(
            school_id=school_id,
            title="Cross-school Draft",
            collaborator_user_ids=[outsider["id"]],
        ),
    )
    assert cross_school.status_code == 422, cross_school.json()
    assert cross_school.json()["detail"] == "Selected co-teacher must belong to course school"

    _grant_school_teacher(peer["id"], school_id)
    first = client.post(
        "/api/v1/courses",
        headers=_auth(owner["token"]),
        json=_draft_payload(
            school_id=school_id,
            title="Teacher Course One",
            collaborator_user_ids=[peer["id"]],
        ),
    )
    second = client.post(
        "/api/v1/courses",
        headers=_auth(owner["token"]),
        json=_draft_payload(
            school_id=school_id,
            title="Teacher Course Two",
        ),
    )
    assert first.status_code == 201, first.json()
    assert second.status_code == 201, second.json()

    owner_list = client.get(
        "/api/v1/courses",
        headers=_auth(owner["token"]),
        params={"school_id": school_id},
    )
    assert owner_list.status_code == 200, owner_list.json()
    assert {item["title"] for item in owner_list.json()} == {
        "Teacher Course One",
        "Teacher Course Two",
    }

    duplicate_teacher = client.post(
        "/api/v1/courses",
        headers=_auth(owner["token"]),
        json=_draft_payload(
            school_id=school_id,
            title="Duplicate Teacher Draft",
            collaborator_user_ids=[peer["id"], peer["id"]],
        ),
    )
    assert duplicate_teacher.status_code == 422, duplicate_teacher.json()

    open_with_class = _draft_payload(
        school_id=school_id,
        title="Invalid Open Draft",
    )
    open_with_class["admission_class_ids"] = [999]
    invalid_admission = client.post(
        "/api/v1/courses",
        headers=_auth(owner["token"]),
        json=open_with_class,
    )
    assert invalid_admission.status_code == 422, invalid_admission.json()

    student_create = client.post(
        "/api/v1/courses",
        headers=_auth(student["token"]),
        json=_draft_payload(school_id=school_id, title="Student Must Not Create"),
    )
    assert student_create.status_code == 403, student_create.json()

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        titles = set(
            db.scalars(select(Course.title).where(Course.school_id == school_id)).all()
        )
        assert titles == {"Teacher Course One", "Teacher Course Two"}
