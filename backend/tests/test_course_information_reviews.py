import re

from sqlalchemy import func, inspect, select, text

from app.core.config import get_settings
from app.db.session import get_session_factory
from app.models import (
    ClassGroup,
    Course,
    CourseAdmissionClass,
    CourseClass,
    CourseCollaborator,
    CourseInformationRevision,
    SchoolMembership,
)
from app.services import course_information_reviews


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Cookie": ""}


def _bootstrap_admin(client, username: str) -> str:
    password = "Course-review-admin-123"
    created = client.post(
        "/api/admin/bootstrap",
        json={
            "username": username,
            "display_name": username.replace("_", " ").title(),
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


def _register_teacher(client, username: str) -> dict:
    password = "Course-review-teacher-123"
    created = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "display_name": username.replace("_", " ").title(),
            "password": password,
            "role": "teacher",
        },
    )
    assert created.status_code == 201, created.json()
    logged_in = client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    assert logged_in.status_code == 200, logged_in.json()
    return {"id": created.json()["id"], "token": logged_in.json()["access_token"]}


def _create_school(client, owner: dict, name: str) -> int:
    response = client.post(
        "/api/schools",
        headers=_auth(owner["token"]),
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


def _create_homeroom(client, owner: dict, school_id: int, name: str) -> int:
    response = client.post(
        "/api/classes",
        headers=_auth(owner["token"]),
        json={
            "school_id": school_id,
            "name": name,
            "grade": "10",
            "term": "2026A",
        },
    )
    assert response.status_code == 201, response.json()
    return response.json()["id"]


def _course_payload(
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
        "summary": f"{title} summary",
        "academic_year": "2026—2027",
        "schedule_text": "Wednesday 14:00—15:40",
        "total_hours": 36,
        "galaxy_key": "astra-core",
        "subject_key": "physics-mechanics",
        "admission_mode": admission_mode,
        "collaborator_user_ids": collaborator_user_ids or [],
        "admission_class_ids": admission_class_ids or [],
    }


def _create_and_submit_course(client, owner: dict, payload: dict) -> dict:
    created = client.post(
        "/api/v1/courses",
        headers=_auth(owner["token"]),
        json=payload,
    )
    assert created.status_code == 201, created.json()
    course = created.json()
    submitted = client.post(
        f"/api/v1/courses/{course['id']}/information-revisions/"
        f"{course['information_revision']['id']}/submit",
        headers=_auth(owner["token"]),
    )
    assert submitted.status_code == 200, submitted.json()
    return submitted.json()


def _review(
    client, admin_token: str, revision_id: int, decision: str, note: str
) -> dict:
    response = client.patch(
        f"/api/v1/admin/course-information-revisions/{revision_id}",
        headers=_auth(admin_token),
        json={"status": decision, "note": note},
    )
    assert response.status_code == 200, response.json()
    return response.json()


def test_admin_approves_course_information_without_creating_placeholder_release(
    client,
) -> None:
    admin = _bootstrap_admin(client, "course_review_admin_approve")
    owner = _register_teacher(client, "course_review_owner_approve")
    peer = _register_teacher(client, "course_review_peer_approve")
    school_id = _create_school(client, owner, "Course Review Approval School")
    _grant_school_teacher(peer["id"], school_id)
    homeroom_id = _create_homeroom(client, owner, school_id, "Course Review Homeroom")
    submitted = _create_and_submit_course(
        client,
        owner,
        _course_payload(
            school_id=school_id,
            title="Approved Physics Course",
            collaborator_user_ids=[peer["id"]],
            admission_mode="class_restricted",
            admission_class_ids=[homeroom_id],
        ),
    )
    course_id = submitted["id"]
    revision_id = submitted["information_revision"]["id"]

    forbidden = client.get(
        "/api/v1/admin/course-information-revisions",
        headers=_auth(owner["token"]),
    )
    assert forbidden.status_code == 403, forbidden.json()
    queue = client.get(
        "/api/v1/admin/course-information-revisions",
        headers=_auth(admin),
    )
    assert queue.status_code == 200, queue.json()
    assert queue.json()["total"] == 1
    pending = queue.json()["items"][0]
    assert pending["revision"]["id"] == revision_id
    assert pending["current_information"] is None
    assert pending["current_teachers"] == []
    assert pending["internal_class_id"] is None
    assert pending["content_status_label"] == "暂无已发布内容"
    assert {item["user_id"] for item in pending["proposed_teachers"]} == {
        owner["id"],
        peer["id"],
    }

    approved = _review(
        client, admin, revision_id, "approved", "Course information is valid"
    )
    assert approved["revision"]["status"] == "approved"
    assert approved["course_status"] == "published"
    assert approved["current_information_revision_id"] == revision_id
    assert re.fullmatch(r"[A-HJ-NP-Z2-9]{8}", approved["course_code"])
    assert approved["course_code"] != str(course_id)
    assert approved["internal_class_id"] is not None
    assert approved["internal_course_class_id"] is not None
    assert approved["has_published_content"] is False
    assert approved["content_status"] == "not_published"
    assert approved["content_status_label"] == "暂无已发布内容"

    duplicate = client.patch(
        f"/api/v1/admin/course-information-revisions/{revision_id}",
        headers=_auth(admin),
        json={"status": "approved", "note": "duplicate"},
    )
    assert duplicate.status_code == 409, duplicate.json()

    detail = client.get(f"/api/v1/courses/{course_id}", headers=_auth(peer["token"]))
    assert detail.status_code == 200, detail.json()
    assert detail.json()["course_code"] == approved["course_code"]
    assert detail.json()["status"] == "published"
    assert detail.json()["has_published_content"] is False
    assert detail.json()["content_status_label"] == "暂无已发布内容"

    visible_classes = client.get(
        "/api/classes",
        headers=_auth(owner["token"]),
        params={"school_id": school_id},
    )
    assert visible_classes.status_code == 200, visible_classes.json()
    assert [item["id"] for item in visible_classes.json()] == [homeroom_id]

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        course = db.get(Course, course_id)
        assert course is not None
        assert course.status == "published"
        assert course.current_information_revision_id == revision_id
        cohorts = list(
            db.scalars(
                select(ClassGroup).where(
                    ClassGroup.school_id == school_id,
                    ClassGroup.kind == "course_cohort",
                )
            ).all()
        )
        assert len(cohorts) == 1
        assert cohorts[0].id == approved["internal_class_id"]
        course_classes = list(
            db.scalars(
                select(CourseClass).where(CourseClass.course_id == course_id)
            ).all()
        )
        assert len(course_classes) == 1
        assert course_classes[0].class_id == cohorts[0].id
        assert (
            db.scalar(
                select(func.count())
                .select_from(CourseCollaborator)
                .where(
                    CourseCollaborator.course_id == course_id,
                    CourseCollaborator.status == "active",
                )
            )
            == 1
        )
        assert (
            db.scalar(
                select(func.count())
                .select_from(CourseAdmissionClass)
                .where(
                    CourseAdmissionClass.course_id == course_id,
                    CourseAdmissionClass.status == "active",
                )
            )
            == 1
        )
        if inspect(db.get_bind()).has_table("course_releases"):
            assert db.scalar(text("SELECT COUNT(*) FROM course_releases")) == 0
        if inspect(db.get_bind()).has_table("course_class_release_bindings"):
            assert (
                db.scalar(text("SELECT COUNT(*) FROM course_class_release_bindings"))
                == 0
            )

    audit = client.get(
        "/api/admin/audit-logs",
        headers=_auth(admin),
        params={
            "action": "course.information_revision.approve",
            "resource_id": revision_id,
        },
    )
    assert audit.status_code == 200, audit.json()
    assert audit.json()["total"] == 1
    after = audit.json()["items"][0]["snapshot_json"]["after"]
    assert after["course_code"] == approved["course_code"]
    assert after["has_published_content"] is False


def test_rejected_initial_information_can_be_revised_and_resubmitted(client) -> None:
    admin = _bootstrap_admin(client, "course_review_admin_resubmit")
    owner = _register_teacher(client, "course_review_owner_resubmit")
    first_peer = _register_teacher(client, "course_review_first_peer")
    replacement_peer = _register_teacher(client, "course_review_replacement_peer")
    school_id = _create_school(client, owner, "Course Review Resubmit School")
    _grant_school_teacher(first_peer["id"], school_id)
    _grant_school_teacher(replacement_peer["id"], school_id)
    homeroom_id = _create_homeroom(
        client, owner, school_id, "Course Review Resubmit Class"
    )
    submitted = _create_and_submit_course(
        client,
        owner,
        _course_payload(
            school_id=school_id,
            title="Rejected Initial Course",
            collaborator_user_ids=[first_peer["id"]],
        ),
    )
    course_id = submitted["id"]
    first_revision_id = submitted["information_revision"]["id"]
    rejected = _review(
        client, admin, first_revision_id, "rejected", "Please revise the schedule"
    )
    assert rejected["revision"]["status"] == "rejected"
    assert rejected["course_status"] == "draft"
    assert rejected["course_code"] is None
    assert rejected["current_information_revision_id"] is None
    assert rejected["internal_class_id"] is None

    revised_payload = _course_payload(
        school_id=school_id,
        title="Revised Initial Course",
        collaborator_user_ids=[replacement_peer["id"]],
        admission_mode="class_restricted",
        admission_class_ids=[homeroom_id],
    )
    revised = client.post(
        f"/api/v1/courses/{course_id}/information-revisions",
        headers=_auth(owner["token"]),
        json=revised_payload,
    )
    assert revised.status_code == 201, revised.json()
    assert revised.json()["information_revision"]["revision_number"] == 2
    assert revised.json()["information_revision"]["status"] == "draft"
    assert revised.json()["information_revision"]["information_snapshot"]["title"] == (
        "Revised Initial Course"
    )
    second_revision_id = revised.json()["information_revision"]["id"]

    submitted_again = client.post(
        f"/api/v1/courses/{course_id}/information-revisions/{second_revision_id}/submit",
        headers=_auth(owner["token"]),
    )
    assert submitted_again.status_code == 200, submitted_again.json()
    approved = _review(
        client, admin, second_revision_id, "approved", "Revision accepted"
    )
    assert approved["course_status"] == "published"
    assert approved["proposed_information"]["title"] == "Revised Initial Course"
    assert {item["user_id"] for item in approved["proposed_teachers"]} == {
        owner["id"],
        replacement_peer["id"],
    }

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        course = db.get(Course, course_id)
        assert course is not None
        assert course.title == "Revised Initial Course"
        assert course.current_information_revision_id == second_revision_id
        revisions = list(
            db.scalars(
                select(CourseInformationRevision)
                .where(CourseInformationRevision.course_id == course_id)
                .order_by(CourseInformationRevision.revision_number)
            ).all()
        )
        assert [item.status for item in revisions] == ["rejected", "approved"]
        collaborators = list(
            db.scalars(
                select(CourseCollaborator)
                .where(CourseCollaborator.course_id == course_id)
                .order_by(CourseCollaborator.user_id)
            ).all()
        )
        assert {item.user_id: item.status for item in collaborators} == {
            first_peer["id"]: "inactive",
            replacement_peer["id"]: "active",
        }
        active_admission_ids = set(
            db.scalars(
                select(CourseAdmissionClass.class_id).where(
                    CourseAdmissionClass.course_id == course_id,
                    CourseAdmissionClass.status == "active",
                )
            ).all()
        )
        assert active_admission_ids == {homeroom_id}


def test_running_course_rejection_preserves_approved_information_and_internal_scope(
    client,
) -> None:
    admin = _bootstrap_admin(client, "course_review_admin_running")
    owner = _register_teacher(client, "course_review_owner_running")
    peer = _register_teacher(client, "course_review_peer_running")
    school_id = _create_school(client, owner, "Course Review Running School")
    _grant_school_teacher(peer["id"], school_id)
    initial = _create_and_submit_course(
        client,
        owner,
        _course_payload(
            school_id=school_id,
            title="Running Approved Course",
            collaborator_user_ids=[peer["id"]],
        ),
    )
    first_revision_id = initial["information_revision"]["id"]
    first_approval = _review(
        client, admin, first_revision_id, "approved", "Initial approval"
    )
    course_id = first_approval["course_id"]
    original_code = first_approval["course_code"]
    original_class_id = first_approval["internal_class_id"]
    original_course_class_id = first_approval["internal_course_class_id"]

    change = client.post(
        f"/api/v1/courses/{course_id}/information-revisions",
        headers=_auth(owner["token"]),
        json=_course_payload(
            school_id=school_id,
            title="Rejected Running Course Change",
            collaborator_user_ids=[],
        ),
    )
    assert change.status_code == 201, change.json()
    change_revision_id = change.json()["information_revision"]["id"]
    submitted_change = client.post(
        f"/api/v1/courses/{course_id}/information-revisions/{change_revision_id}/submit",
        headers=_auth(owner["token"]),
    )
    assert submitted_change.status_code == 200, submitted_change.json()

    queue = client.get(
        "/api/v1/admin/course-information-revisions",
        headers=_auth(admin),
        params={"status": "submitted"},
    )
    assert queue.status_code == 200, queue.json()
    pending = next(
        item
        for item in queue.json()["items"]
        if item["revision"]["id"] == change_revision_id
    )
    assert pending["current_information"]["title"] == "Running Approved Course"
    assert pending["proposed_information"]["title"] == "Rejected Running Course Change"
    assert "title" in pending["changed_fields"]
    assert "teacher_ids" in pending["changed_fields"]

    rejected = _review(
        client, admin, change_revision_id, "rejected", "Keep current information"
    )
    assert rejected["course_code"] == original_code
    assert rejected["internal_class_id"] == original_class_id
    assert rejected["internal_course_class_id"] == original_course_class_id
    assert rejected["current_information_revision_id"] == first_revision_id
    assert rejected["current_information"]["title"] == "Running Approved Course"

    detail = client.get(f"/api/v1/courses/{course_id}", headers=_auth(peer["token"]))
    assert detail.status_code == 200, detail.json()
    assert detail.json()["title"] == "Running Approved Course"
    assert detail.json()["course_code"] == original_code
    assert detail.json()["current_information_revision_id"] == first_revision_id
    assert {item["user_id"] for item in detail.json()["teachers"]} == {
        owner["id"],
        peer["id"],
    }


def test_first_approval_rolls_back_course_code_when_internal_scope_creation_fails(
    client,
    monkeypatch,
) -> None:
    admin = _bootstrap_admin(client, "course_review_admin_rollback")
    owner = _register_teacher(client, "course_review_owner_rollback")
    school_id = _create_school(client, owner, "Course Review Rollback School")
    submitted = _create_and_submit_course(
        client,
        owner,
        _course_payload(school_id=school_id, title="Rollback Course"),
    )
    course_id = submitted["id"]
    revision_id = submitted["information_revision"]["id"]
    original_scope_builder = course_information_reviews._ensure_internal_course_scope

    def fail_scope_creation(db, course):
        raise RuntimeError("simulated internal scope failure")

    monkeypatch.setattr(
        course_information_reviews,
        "_ensure_internal_course_scope",
        fail_scope_creation,
    )
    failed = client.patch(
        f"/api/v1/admin/course-information-revisions/{revision_id}",
        headers=_auth(admin),
        json={"status": "approved", "note": "must roll back"},
    )
    assert failed.status_code == 500

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        course = db.get(Course, course_id)
        revision = db.get(CourseInformationRevision, revision_id)
        assert course is not None
        assert revision is not None
        assert course.status == "draft"
        assert course.course_code is None
        assert course.current_information_revision_id is None
        assert revision.status == "submitted"
        assert (
            db.scalar(
                select(func.count())
                .select_from(ClassGroup)
                .where(
                    ClassGroup.school_id == school_id,
                    ClassGroup.kind == "course_cohort",
                )
            )
            == 0
        )
        assert (
            db.scalar(
                select(func.count())
                .select_from(CourseClass)
                .where(CourseClass.course_id == course_id)
            )
            == 0
        )

    monkeypatch.setattr(
        course_information_reviews,
        "_ensure_internal_course_scope",
        original_scope_builder,
    )
    retry = _review(client, admin, revision_id, "approved", "retry after rollback")
    assert retry["course_status"] == "published"
    assert retry["course_code"] is not None
    assert retry["internal_class_id"] is not None
