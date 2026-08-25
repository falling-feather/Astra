from sqlalchemy import select

from app.core.config import get_settings
from app.db.session import get_session_factory
from app.models import (
    Assignment,
    ClassGroup,
    ClassMembership,
    Course,
    CourseClass,
    CourseEnrollment,
    CourseInformationRevision,
    CourseJoinRequest,
    CourseRelease,
    CourseUnit,
    CourseUnitClassPlan,
    School,
    SchoolMembership,
    Submission,
)
from app.models.base import utc_now
from app.services import workbench as workbench_service


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Cookie": ""}


def _register(client, username: str, role: str = "student") -> dict:
    password = "Workbench-user-password-123"
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
    return {
        "id": created.json()["id"],
        "token": logged_in.json()["access_token"],
    }


def _bootstrap_admin(client, username: str) -> dict:
    password = "Workbench-admin-password-123"
    created = client.post(
        "/api/admin/bootstrap",
        json={
            "username": username,
            "display_name": username.title(),
            "password": password,
        },
    )
    assert created.status_code == 201, created.json()
    logged_in = client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    assert logged_in.status_code == 200, logged_in.json()
    return {
        "id": created.json()["id"],
        "token": logged_in.json()["access_token"],
    }


def _session_factory():
    return get_session_factory(get_settings().database_url)


def test_student_workbench_empty_state_auth_and_pagination_bounds(client) -> None:
    assert client.get("/api/v1/workbench").status_code == 401
    student = _register(client, "workbench_empty_student")

    response = client.get("/api/v1/workbench", headers=_auth(student["token"]))
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["role"] == "student"
    assert body["primary_action"] == {
        "kind": "join_course",
        "label": "加入一门课程",
        "section": "courses",
        "course_id": None,
        "course_unit_id": None,
        "assignment_id": None,
        "class_id": None,
        "submission_id": None,
        "request_id": None,
        "revision_id": None,
    }
    assert body["courses"] == {
        "items": [],
        "total": 0,
        "limit": 6,
        "offset": 0,
        "next_offset": None,
    }
    assert body["assignments"]["items"] == []
    assert body["continue_learning"] is None
    assert body["submissions"] == {"submitted": 0, "graded": 0, "returned": 0}
    assert body["section_errors"] == []

    assert (
        client.get(
            "/api/v1/workbench",
            headers=_auth(student["token"]),
            params={"limit": 0},
        ).status_code
        == 422
    )
    assert (
        client.get(
            "/api/v1/workbench",
            headers=_auth(student["token"]),
            params={"limit": 21},
        ).status_code
        == 422
    )
    assert (
        client.get(
            "/api/v1/workbench",
            headers=_auth(student["token"]),
            params={"offset": -1},
        ).status_code
        == 422
    )


def test_student_workbench_reconciles_course_assignment_and_submission_truth(
    client,
) -> None:
    student = _register(client, "workbench_student_truth")
    teacher = _register(client, "workbench_student_teacher", "teacher")
    with _session_factory()() as db:
        school = School(name="Workbench Student School", status="active")
        db.add(school)
        db.flush()
        homeroom = ClassGroup(
            school_id=school.id,
            name="Workbench Student Homeroom",
            kind="homeroom",
            grade="10",
            term="2026A",
            status="active",
        )
        db.add(homeroom)
        db.flush()
        db.add(
            ClassMembership(
                class_id=homeroom.id,
                user_id=student["id"],
                role="student",
                status="active",
            )
        )
        course_ids: list[int] = []
        pending_assignment_id = 0
        returned_assignment_id = 0
        for index in range(2):
            course = Course(
                school_id=school.id,
                creator_user_id=teacher["id"],
                galaxy_key="englab",
                subject_key="physics",
                course_key=f"workbench-student-{index}",
                title=f"Workbench Student Course {index}",
                course_code=f"WBSTU{index}",
                academic_year="2026—2027",
                schedule_text="Tuesday 14:00",
                total_hours=16,
                admission_mode="open",
                status="published",
            )
            db.add(course)
            db.flush()
            course_ids.append(course.id)
            cohort = ClassGroup(
                school_id=school.id,
                name=f"Workbench Student Cohort {index}",
                kind="course_cohort",
                status="active",
            )
            db.add(cohort)
            db.flush()
            course_class = CourseClass(
                course_id=course.id,
                class_id=cohort.id,
                status="active",
            )
            db.add(course_class)
            db.flush()
            db.add_all(
                [
                    CourseEnrollment(
                        course_id=course.id,
                        student_id=student["id"],
                        source="teacher",
                        status="active",
                    ),
                    ClassMembership(
                        class_id=cohort.id,
                        user_id=student["id"],
                        role="student",
                        status="active",
                    ),
                ]
            )
            unit = CourseUnit(
                course_id=course.id,
                activity_key=f"workbench.activity.{index}",
                title=f"Workbench Unit {index}",
                position=1,
                content_slug=f"workbench-unit-{index}",
                status="published",
            )
            db.add(unit)
            db.flush()
            db.add(
                CourseUnitClassPlan(
                    course_class_id=course_class.id,
                    course_unit_id=unit.id,
                    position=1,
                    release_mode="open",
                )
            )
            assignment = Assignment(
                unit_id=unit.id,
                title=f"Workbench Assignment {index}",
                max_score=100,
                status="active",
                audience_mode="all_attached_classes",
            )
            db.add(assignment)
            db.flush()
            if index == 0:
                returned_assignment_id = assignment.id
                db.add(
                    Submission(
                        assignment_id=assignment.id,
                        student_id=student["id"],
                        class_id=cohort.id,
                        content={"answer": "done"},
                        status="returned",
                        score=88,
                        feedback="请补充单位说明",
                        graded_by_user_id=teacher["id"],
                    )
                )
            else:
                pending_assignment_id = assignment.id
        db.commit()

    first = client.get(
        "/api/v1/workbench",
        headers=_auth(student["token"]),
        params={"limit": 1, "offset": 0},
    )
    assert first.status_code == 200, first.json()
    body = first.json()
    assert body["courses"]["total"] == 2
    assert body["courses"]["next_offset"] == 1
    assert body["assignments"]["total"] == 2
    assert body["assignments"]["items"][0]["assignment_id"] == pending_assignment_id
    assert body["assignments"]["items"][0]["state"] == "pending"
    assert body["primary_action"]["kind"] == "continue_assignment"
    assert body["primary_action"]["assignment_id"] == pending_assignment_id
    assert body["submissions"] == {"submitted": 0, "graded": 0, "returned": 1}
    assert body["homerooms"]["items"][0]["name"] == "Workbench Student Homeroom"

    second = client.get(
        "/api/v1/workbench",
        headers=_auth(student["token"]),
        params={"limit": 1, "offset": 1},
    )
    assert second.status_code == 200, second.json()
    assert second.json()["courses"]["next_offset"] is None
    assert (
        second.json()["assignments"]["items"][0]["assignment_id"]
        == returned_assignment_id
    )
    assert second.json()["assignments"]["items"][0]["feedback"] == "请补充单位说明"

    with _session_factory()() as db:
        assert set(db.scalars(select(Course.id)).all()) == set(course_ids)


def test_teacher_workbench_prioritizes_student_review_and_preserves_other_queues(
    client,
) -> None:
    teacher = _register(client, "workbench_teacher_truth", "teacher")
    student = _register(client, "workbench_teacher_student")
    with _session_factory()() as db:
        school = School(name="Workbench Teacher School", status="active")
        db.add(school)
        db.flush()
        db.add(
            SchoolMembership(
                school_id=school.id,
                user_id=teacher["id"],
                role="teacher",
                status="active",
            )
        )
        course = Course(
            school_id=school.id,
            creator_user_id=teacher["id"],
            galaxy_key="englab",
            subject_key="mathematics",
            course_key="workbench-teacher-course",
            title="Workbench Teacher Course",
            course_code="WBTEACH",
            academic_year="2026—2027",
            schedule_text="Wednesday 10:00",
            total_hours=24,
            admission_mode="open",
            status="published",
            content_draft_revision=1,
        )
        db.add(course)
        db.flush()
        released_course = Course(
            school_id=school.id,
            creator_user_id=teacher["id"],
            galaxy_key="englab",
            subject_key="mathematics",
            course_key="workbench-teacher-released-course",
            title="Workbench Released Course",
            course_code="WBRELEASED",
            academic_year="2026—2027",
            schedule_text="Thursday 10:00",
            total_hours=24,
            admission_mode="open",
            status="published",
            content_draft_revision=2,
        )
        db.add(released_course)
        db.flush()
        db.add(
            CourseRelease(
                course_id=released_course.id,
                release_number=1,
                draft_revision=1,
                schema_version="astra-course-release-v1",
                status="published",
                title_snapshot=released_course.title,
                summary_snapshot=None,
                completion_rule_id=None,
                completion_rule_sha256="0" * 64,
                completion_rule_snapshot={"version": 0},
                package_sha256="1" * 64,
                published_by_user_id=teacher["id"],
                published_at=utc_now(),
            )
        )
        cohort = ClassGroup(
            school_id=school.id,
            name="Workbench Teacher Cohort",
            kind="course_cohort",
            status="active",
        )
        db.add(cohort)
        db.flush()
        course_class = CourseClass(course_id=course.id, class_id=cohort.id, status="active")
        db.add(course_class)
        db.flush()
        unit = CourseUnit(
            course_id=course.id,
            activity_key="workbench.teacher.activity",
            title="Workbench Teacher Unit",
            position=1,
            content_slug="workbench-teacher-unit",
            status="published",
        )
        db.add(unit)
        db.flush()
        db.add(
            CourseUnitClassPlan(
                course_class_id=course_class.id,
                course_unit_id=unit.id,
                position=1,
                release_mode="open",
            )
        )
        assignment = Assignment(
            unit_id=unit.id,
            title="Workbench Teacher Assignment",
            max_score=100,
            status="active",
        )
        db.add(assignment)
        db.flush()
        join_request = CourseJoinRequest(
            course_id=course.id,
            student_id=student["id"],
            request_number=1,
            status="pending",
        )
        db.add(join_request)
        db.add(
            Submission(
                assignment_id=assignment.id,
                student_id=student["id"],
                class_id=cohort.id,
                content={"answer": "pending review"},
                status="submitted",
            )
        )
        db.commit()
        school_id = school.id
        course_id = course.id
        cohort_id = cohort.id
        request_id = join_request.id

    response = client.get("/api/v1/workbench", headers=_auth(teacher["token"]))
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["role"] == "teacher"
    assert body["courses"]["total"] == 2
    courses = {item["title"]: item for item in body["courses"]["items"]}
    assert courses["Workbench Teacher Course"]["has_unpublished_changes"] is True
    assert courses["Workbench Released Course"]["current_release_number"] == 1
    assert courses["Workbench Released Course"]["has_unpublished_changes"] is False
    assert body["pending_students"]["total"] == 1
    assert body["pending_students"]["items"][0]["source_class_name"] == "未关联班级"
    assert body["unpublished_drafts"]["total"] == 1
    assert body["pending_grading"]["total"] == 1
    assert body["pending_grading"]["items"][0]["class_id"] == cohort_id
    assert body["pending_grading"]["items"][0]["submission_id"] > 0
    assignments = client.get(
        f"/api/courses/{course_id}/assignments",
        headers=_auth(teacher["token"]),
        params={"class_id": cohort_id},
    )
    assert assignments.status_code == 200, assignments.json()
    assert assignments.json()[0]["title"] == "Workbench Teacher Assignment"
    assert body["primary_action"]["kind"] == "review_course_join_request"
    assert body["primary_action"]["request_id"] == request_id

    with _session_factory()() as db:
        membership = db.scalar(
            select(SchoolMembership).where(
                SchoolMembership.school_id == school_id,
                SchoolMembership.user_id == teacher["id"],
                SchoolMembership.role == "teacher",
            )
        )
        assert membership is not None
        membership.status = "inactive"
        db.commit()

    hidden = client.get("/api/v1/workbench", headers=_auth(teacher["token"]))
    assert hidden.status_code == 200, hidden.json()
    assert hidden.json()["courses"]["total"] == 0
    assert hidden.json()["pending_students"]["total"] == 0
    assert hidden.json()["unpublished_drafts"]["total"] == 0
    assert hidden.json()["pending_grading"]["total"] == 0


def test_admin_workbench_prioritizes_review_queues_and_reports_organization_alerts(
    client,
) -> None:
    admin = _bootstrap_admin(client, "workbench_admin_truth")
    applicant = _register(client, "workbench_admin_applicant")
    teacher = _register(client, "workbench_admin_teacher", "teacher")
    application = client.post(
        "/api/v1/teacher-applications",
        headers=_auth(applicant["token"]),
        json={"message": "希望负责物理课程"},
    )
    assert application.status_code == 201, application.json()

    with _session_factory()() as db:
        school = School(name="Workbench Archived School", status="archived")
        db.add(school)
        db.flush()
        class_group = ClassGroup(
            school_id=school.id,
            name="Workbench Archived Homeroom",
            kind="homeroom",
            status="archived",
        )
        db.add(class_group)
        course = Course(
            school_id=school.id,
            creator_user_id=teacher["id"],
            galaxy_key="englab",
            subject_key="physics",
            course_key="workbench-admin-course",
            title="Workbench Pending Course",
            academic_year="2026—2027",
            schedule_text="Friday 09:00",
            total_hours=20,
            admission_mode="open",
            status="draft",
        )
        db.add(course)
        db.flush()
        revision = CourseInformationRevision(
            course_id=course.id,
            revision_number=1,
            information_snapshot={"title": course.title},
            teacher_ids_snapshot=[teacher["id"]],
            status="submitted",
            created_by_user_id=teacher["id"],
        )
        db.add(revision)
        db.commit()

    response = client.get(
        "/api/v1/workbench",
        headers=_auth(admin["token"]),
        params={"limit": 1},
    )
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["role"] == "admin"
    assert body["pending_teacher_applications"]["total"] == 1
    assert body["pending_course_revisions"]["total"] == 1
    assert body["organization_alerts"]["total"] == 2
    assert body["organization_alerts"]["next_offset"] == 1
    assert body["catalog_totals"]["users"] == 3
    assert body["catalog_totals"]["courses"] == 1
    assert body["primary_action"]["kind"] == "review_teacher_application"
    assert body["primary_action"]["request_id"] == application.json()["id"]


def test_workbench_keeps_healthy_sections_when_one_section_fails(
    client, monkeypatch
) -> None:
    student = _register(client, "workbench_partial_student")

    def fail_courses(*_args, **_kwargs):
        raise RuntimeError("simulated course query failure")

    monkeypatch.setattr(workbench_service, "_student_courses", fail_courses)
    response = client.get("/api/v1/workbench", headers=_auth(student["token"]))
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["courses"]["items"] == []
    assert body["assignments"]["items"] == []
    assert body["submissions"] == {"submitted": 0, "graded": 0, "returned": 0}
    assert body["section_errors"] == [
        {
            "section": "courses",
            "code": "section_unavailable",
            "message": "该部分暂时无法读取，其他工作台内容仍可使用",
        }
    ]
