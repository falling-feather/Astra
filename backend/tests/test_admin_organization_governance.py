import json
from datetime import date
from inspect import getsource

import pytest
from sqlalchemy import select

from app.api.endpoints import (
    assignment_policies,
    classes,
    courses,
    knowledge,
    learning_events,
    points,
    schools,
    submissions,
)
from app.core.config import get_settings
from app.db.session import get_session_factory
from app.models import ClassMembership, SchoolMembership
from app.services import class_join_requests, course_release_write_gate
from app.services.knowledge_snapshot_runs import rebuild_periodic_knowledge_snapshots


def _auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Cookie": ""}


def _bootstrap_admin(client) -> dict:
    response = client.post(
        "/api/admin/bootstrap",
        json={
            "username": "organization_admin",
            "password": "secret123",
            "display_name": "Organization Admin",
        },
    )
    assert response.status_code == 201
    login = client.post(
        "/api/auth/login",
        json={"username": "organization_admin", "password": "secret123"},
    )
    assert login.status_code == 200
    return {**response.json(), "token": login.json()["access_token"]}


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
    return {**response.json(), "token": login.json()["access_token"]}


def _create_organization(client, teacher: dict, suffix: str) -> tuple[dict, dict]:
    school = client.post(
        "/api/schools",
        headers=_auth_header(teacher["token"]),
        json={"name": f"Organization School {suffix}", "region": "Shanghai"},
    )
    assert school.status_code == 201
    class_group = client.post(
        "/api/classes",
        headers=_auth_header(teacher["token"]),
        json={
            "school_id": school.json()["id"],
            "name": f"Organization Class {suffix}",
            "grade": "10",
            "term": "2026A",
        },
    )
    assert class_group.status_code == 201
    return school.json(), class_group.json()


def _create_learning_scope(
    client,
    teacher: dict,
    student: dict,
    school_id: int,
    class_id: int,
) -> tuple[int, int]:
    join = client.post(
        f"/api/classes/{class_id}/join",
        headers=_auth_header(student["token"]),
        json={"role": "student"},
    )
    assert join.status_code == 201
    course = client.post(
        "/api/courses",
        headers=_auth_header(teacher["token"]),
        json={"school_id": school_id, "title": "Organization Course", "status": "published"},
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
        json={"title": "Organization Unit", "position": 1, "status": "published"},
    )
    assert unit.status_code == 201
    assignment = client.post(
        f"/api/courses/{course_id}/units/{unit.json()['id']}/assignments",
        headers=_auth_header(teacher["token"]),
        json={"title": "Organization Assignment", "max_score": 20, "status": "active"},
    )
    assert assignment.status_code == 201
    return course_id, assignment.json()["id"]


def _patch_organization(
    client,
    admin: dict,
    resource: str,
    resource_id: int,
    payload: dict,
    *,
    request_id: str | None = None,
):
    headers = _auth_header(admin["token"])
    if request_id is not None:
        headers["X-Request-ID"] = request_id
    return client.patch(
        f"/api/admin/{resource}/{resource_id}",
        headers=headers,
        json=payload,
    )


def test_admin_organization_updates_are_versioned_whitelisted_and_audited(client):
    admin = _bootstrap_admin(client)
    teacher = _register_and_login(client, "organization_editor", "teacher")
    school, class_group = _create_organization(client, teacher, "Contract")

    school_read = client.get(
        f"/api/admin/schools/{school['id']}",
        headers=_auth_header(admin["token"]),
    )
    class_read = client.get(
        f"/api/admin/classes/{class_group['id']}",
        headers=_auth_header(admin["token"]),
    )
    assert school_read.status_code == class_read.status_code == 200
    assert school_read.json()["version"] == class_read.json()["version"] == 1
    assert school_read.json()["description"] is None
    assert class_read.json()["description"] is None
    assert school_read.json()["created_at"] and school_read.json()["updated_at"]

    forbidden = client.patch(
        f"/api/admin/schools/{school['id']}",
        headers=_auth_header(teacher["token"]),
        json={"expected_version": 1, "reason": "teacher must not govern", "region": "Beijing"},
    )
    assert forbidden.status_code == 403
    forbidden_class = client.patch(
        f"/api/admin/classes/{class_group['id']}",
        headers=_auth_header(teacher["token"]),
        json={"expected_version": 1, "reason": "teacher must not govern", "grade": "11"},
    )
    assert forbidden_class.status_code == 403

    raw_write = _patch_organization(
        client,
        admin,
        "schools",
        school["id"],
        {
            "expected_version": 1,
            "reason": "raw write must be rejected",
            "table": "schools",
            "sql": "drop table schools",
        },
    )
    assert raw_write.status_code == 422
    missing_fields = _patch_organization(
        client,
        admin,
        "schools",
        school["id"],
        {"expected_version": 1, "reason": "metadata only"},
    )
    assert missing_fields.status_code == 422
    blank_name = _patch_organization(
        client,
        admin,
        "schools",
        school["id"],
        {"expected_version": 1, "reason": "blank names are invalid", "name": "   "},
    )
    assert blank_name.status_code == 422
    null_status = _patch_organization(
        client,
        admin,
        "schools",
        school["id"],
        {"expected_version": 1, "reason": "null status is invalid", "status": None},
    )
    assert null_status.status_code == 422
    blank_reason = _patch_organization(
        client,
        admin,
        "schools",
        school["id"],
        {"expected_version": 1, "reason": "   ", "description": "must not persist"},
    )
    assert blank_reason.status_code == 422

    school_update = _patch_organization(
        client,
        admin,
        "schools",
        school["id"],
        {
            "expected_version": 1,
            "reason": "normalize organization metadata",
            "name": "  Organization School Contract Updated  ",
            "region": "   ",
            "description": "  Contract description  ",
        },
        request_id="be003-school-contract",
    )
    assert school_update.status_code == 200
    assert school_update.json()["version"] == 2
    assert school_update.json()["name"] == "Organization School Contract Updated"
    assert school_update.json()["region"] is None
    assert school_update.json()["description"] == "Contract description"
    authoritative_school = client.get(
        f"/api/admin/schools/{school['id']}",
        headers=_auth_header(admin["token"]),
    )
    assert authoritative_school.json() == school_update.json()

    replay = _patch_organization(
        client,
        admin,
        "schools",
        school["id"],
        {"expected_version": 1, "reason": "stale replay", "region": "Zhejiang"},
    )
    assert replay.status_code == 409
    no_op = _patch_organization(
        client,
        admin,
        "schools",
        school["id"],
        {
            "expected_version": 2,
            "reason": "same value must not create audit",
            "description": "Contract description",
        },
    )
    assert no_op.status_code == 409
    duplicate_school = client.post(
        "/api/schools",
        headers=_auth_header(teacher["token"]),
        json={"name": "Organization Duplicate School"},
    )
    assert duplicate_school.status_code == 201
    duplicate_school_name = _patch_organization(
        client,
        admin,
        "schools",
        school["id"],
        {
            "expected_version": 2,
            "reason": "duplicate names are rejected",
            "name": duplicate_school.json()["name"],
        },
    )
    assert duplicate_school_name.status_code == 409

    school_audit = client.get(
        f"/api/admin/audit-logs?action=admin.school.update&resource_id={school['id']}",
        headers=_auth_header(admin["token"]),
    )
    assert school_audit.status_code == 200
    assert school_audit.json()["total"] == 1
    school_snapshot = school_audit.json()["items"][0]["snapshot_json"]
    assert school_snapshot["expected_version"] == 1
    assert school_snapshot["new_version"] == 2
    assert school_snapshot["reason"] == "normalize organization metadata"
    assert set(school_snapshot["changes"]) == {"name", "region", "description"}
    school_audit_item = school_audit.json()["items"][0]
    assert school_audit_item["request_id"] == "be003-school-contract"
    assert school_audit_item["resource_type"] == "school"
    assert school_audit_item["resource_id"] == str(school["id"])
    assert school_audit_item["school_id"] == school["id"]
    assert school_audit_item["class_id"] is None
    assert school_snapshot["responsible_count"] == 1
    assert school_snapshot["active_child_class_count"] == 1
    assert school_snapshot["before"]["version"] == 1
    assert school_snapshot["after"]["version"] == 2

    class_update = _patch_organization(
        client,
        admin,
        "classes",
        class_group["id"],
        {
            "expected_version": 1,
            "reason": "Bearer organization-class-secret",
            "grade": " 11 ",
            "term": " 2026B ",
            "description": "  Class description  ",
        },
        request_id="be003-class-contract",
    )
    assert class_update.status_code == 200
    assert class_update.json()["version"] == 2
    assert class_update.json()["grade"] == "11"
    assert class_update.json()["term"] == "2026B"
    assert class_update.json()["description"] == "Class description"
    authoritative_class = client.get(
        f"/api/admin/classes/{class_group['id']}",
        headers=_auth_header(admin["token"]),
    )
    assert authoritative_class.json() == class_update.json()
    stale_class = _patch_organization(
        client,
        admin,
        "classes",
        class_group["id"],
        {"expected_version": 1, "reason": "stale class replay", "term": "2027A"},
    )
    assert stale_class.status_code == 409
    class_no_op = _patch_organization(
        client,
        admin,
        "classes",
        class_group["id"],
        {"expected_version": 2, "reason": "class no-op", "description": "Class description"},
    )
    assert class_no_op.status_code == 409
    duplicate_class = client.post(
        "/api/classes",
        headers=_auth_header(teacher["token"]),
        json={"school_id": school["id"], "name": "Organization Duplicate Class"},
    )
    assert duplicate_class.status_code == 201
    cross_school_move = _patch_organization(
        client,
        admin,
        "classes",
        class_group["id"],
        {
            "expected_version": 2,
            "reason": "class school is immutable",
            "school_id": duplicate_school.json()["id"],
        },
    )
    assert cross_school_move.status_code == 422
    after_cross_school = client.get(
        f"/api/admin/classes/{class_group['id']}",
        headers=_auth_header(admin["token"]),
    )
    assert after_cross_school.json()["school_id"] == school["id"]
    assert after_cross_school.json()["version"] == 2
    duplicate_class_name = _patch_organization(
        client,
        admin,
        "classes",
        class_group["id"],
        {
            "expected_version": 2,
            "reason": "duplicate class names are rejected",
            "name": duplicate_class.json()["name"],
        },
    )
    assert duplicate_class_name.status_code == 409

    class_audit = client.get(
        f"/api/admin/audit-logs?action=admin.class.update&resource_id={class_group['id']}",
        headers=_auth_header(admin["token"]),
    )
    assert class_audit.status_code == 200
    assert class_audit.json()["total"] == 1
    class_snapshot = class_audit.json()["items"][0]["snapshot_json"]
    assert class_snapshot["reason"] == {"redacted": True, "reason": "audit_snapshot_policy"}
    assert "organization-class-secret" not in json.dumps(class_snapshot)
    class_audit_item = class_audit.json()["items"][0]
    assert class_audit_item["request_id"] == "be003-class-contract"
    assert class_audit_item["resource_type"] == "class"
    assert class_audit_item["resource_id"] == str(class_group["id"])
    assert class_audit_item["school_id"] == school["id"]
    assert class_audit_item["class_id"] == class_group["id"]
    assert class_snapshot["active_teacher_count"] == 1
    assert class_snapshot["before"]["version"] == 1
    assert class_snapshot["after"]["version"] == 2


def test_admin_organization_archive_preserves_reads_and_rejects_scoped_writes(client):
    admin = _bootstrap_admin(client)
    teacher = _register_and_login(client, "organization_archive_teacher", "teacher")
    student = _register_and_login(client, "organization_archive_student", "student")
    school, class_group = _create_organization(client, teacher, "Archive")
    course_id, assignment_id = _create_learning_scope(
        client,
        teacher,
        student,
        school["id"],
        class_group["id"],
    )
    point_rule = client.patch(
        f"/api/points/assignments/{assignment_id}/rule",
        headers=_auth_header(teacher["token"]),
        json={"enabled": True, "points_per_score": 2, "max_points": 40},
    )
    assert point_rule.status_code == 200
    historical_submission = client.post(
        f"/api/assignments/{assignment_id}/submissions",
        headers=_auth_header(student["token"]),
        json={"class_id": class_group["id"], "content": {"answer": "historical answer"}},
    )
    assert historical_submission.status_code == 201
    grade = client.patch(
        f"/api/submissions/{historical_submission.json()['id']}/grade",
        headers=_auth_header(teacher["token"]),
        json={"score": 10, "feedback": "historical grade"},
    )
    assert grade.status_code == 200
    historical_event = client.post(
        "/api/learning-events",
        headers=_auth_header(student["token"]),
        json={
            "course_id": course_id,
            "class_id": class_group["id"],
            "event_type": "visit",
            "payload": {},
        },
    )
    assert historical_event.status_code == 201

    active_child_conflict = _patch_organization(
        client,
        admin,
        "schools",
        school["id"],
        {"expected_version": 1, "reason": "archive parent first", "status": "archived"},
    )
    assert active_child_conflict.status_code == 409

    class_archive = _patch_organization(
        client,
        admin,
        "classes",
        class_group["id"],
        {"expected_version": 1, "reason": "class lifecycle drill", "status": "archived"},
    )
    assert class_archive.status_code == 200
    assert class_archive.json()["status"] == "archived"
    assert class_archive.json()["version"] == 2

    center = client.get("/api/assignments/me", headers=_auth_header(student["token"]))
    assert center.status_code == 200
    center_item = next(item for item in center.json()["items"] if item["assignment"]["id"] == assignment_id)
    assert center_item["can_submit"] is False
    assert center_item["read_only"] is True
    assert center_item["submit_block_reason"] == "class_archived"
    assert center_item["submission"]["id"] == historical_submission.json()["id"]
    active_center = client.get(
        "/api/assignments/me?filter=active",
        headers=_auth_header(student["token"]),
    )
    assert active_center.status_code == 200
    assert active_center.json()["items"] == []
    history_center = client.get(
        "/api/assignments/me?filter=history",
        headers=_auth_header(student["token"]),
    )
    assert history_center.status_code == 200
    assert [item["assignment"]["id"] for item in history_center.json()["items"]] == [assignment_id]
    review = client.get(
        f"/api/assignments/{assignment_id}/review?class_id={class_group['id']}",
        headers=_auth_header(student["token"]),
    )
    assert review.status_code == 200
    assert review.json()["can_submit"] is False
    assert review.json()["read_only"] is True
    assert review.json()["submit_block_reason"] == "class_archived"

    blocked_submission = client.post(
        f"/api/assignments/{assignment_id}/submissions",
        headers=_auth_header(student["token"]),
        json={"class_id": class_group["id"], "content": {"answer": "must not persist"}},
    )
    assert blocked_submission.status_code == 409
    blocked_join = client.post(
        f"/api/classes/{class_group['id']}/join",
        headers=_auth_header(student["token"]),
        json={"role": "student"},
    )
    assert blocked_join.status_code == 409
    blocked_snapshot = client.post(
        f"/api/classes/{class_group['id']}/knowledge/snapshots"
        "?from=2026-07-01T00:00:00Z&to=2026-07-01T23:59:59Z",
        headers=_auth_header(teacher["token"]),
    )
    assert blocked_snapshot.status_code == 409

    current_knowledge = client.get(
        "/api/knowledge/me",
        headers=_auth_header(student["token"]),
    )
    assert current_knowledge.status_code == 200
    assert {
        field: current_knowledge.json()[field]
        for field in (
            "assignment_count",
            "submitted_assignments",
            "graded_assignments",
            "total_events",
            "score_total",
            "max_score_total",
            "total_points",
        )
    } == {
        "assignment_count": 0,
        "submitted_assignments": 0,
        "graded_assignments": 0,
        "total_events": 0,
        "score_total": 0,
        "max_score_total": 0,
        "total_points": 0,
    }
    current_snapshot = client.post(
        "/api/knowledge/me/snapshots"
        "?from=2026-07-01T00:00:00Z&to=2026-07-01T23:59:59Z",
        headers=_auth_header(student["token"]),
    )
    assert current_snapshot.status_code == 201
    assert current_snapshot.json()["assignment_count"] == 0
    assert current_snapshot.json()["total_events"] == 0
    assert current_snapshot.json()["total_points"] == 0

    current_progress = client.get(
        "/api/progress/me",
        headers=_auth_header(student["token"]),
    )
    assert current_progress.status_code == 200
    assert current_progress.json()["submitted_assignments"] == 0
    assert current_progress.json()["graded_assignments"] == 0
    assert current_progress.json()["learning_events"] == 0
    assert current_progress.json()["total_points"] == 0
    historical_events = client.get(
        "/api/learning-events",
        headers=_auth_header(student["token"]),
    )
    assert historical_events.status_code == 200
    assert historical_event.json()["id"] in {item["id"] for item in historical_events.json()}
    assert {item["class_id"] for item in historical_events.json()} == {class_group["id"]}
    historical_submissions = client.get(
        f"/api/assignments/{assignment_id}/submissions?class_id={class_group['id']}",
        headers=_auth_header(teacher["token"]),
    )
    assert historical_submissions.status_code == 200
    assert [item["id"] for item in historical_submissions.json()] == [
        historical_submission.json()["id"]
    ]

    unscoped_student_event = client.post(
        "/api/learning-events",
        headers=_auth_header(student["token"]),
        json={"course_id": course_id, "event_type": "visit", "payload": {}},
    )
    assert unscoped_student_event.status_code == 422
    archived_class_event = client.post(
        "/api/learning-events",
        headers=_auth_header(student["token"]),
        json={
            "course_id": course_id,
            "class_id": class_group["id"],
            "event_type": "visit",
            "payload": {},
        },
    )
    assert archived_class_event.status_code == 409

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        class_archived_periodic_run = rebuild_periodic_knowledge_snapshots(
            db,
            granularity="day",
            reference_date=date(2036, 7, 15),
            trigger_source="organization_class_archive_test",
        )
        assert class_archived_periodic_run.class_snapshot_count == 0
        assert class_archived_periodic_run.user_snapshot_count == 0
        assert class_archived_periodic_run.metadata_json["class_course_pairs"] == 0

    class_read = client.get(
        f"/api/admin/classes/{class_group['id']}",
        headers=_auth_header(admin["token"]),
    )
    class_stats = client.get(
        f"/api/admin/classes/{class_group['id']}/stats",
        headers=_auth_header(admin["token"]),
    )
    assert class_read.status_code == class_stats.status_code == 200
    assert class_read.json()["status"] == "archived"

    school_archive = _patch_organization(
        client,
        admin,
        "schools",
        school["id"],
        {"expected_version": 1, "reason": "school lifecycle drill", "status": "archived"},
    )
    assert school_archive.status_code == 200
    assert school_archive.json()["version"] == 2
    assert school_archive.json()["status"] == "archived"

    blocked_course_snapshot = client.post(
        "/api/knowledge/me/snapshots"
        f"?course_id={course_id}&from=2026-07-02T00:00:00Z&to=2026-07-02T23:59:59Z",
        headers=_auth_header(student["token"]),
    )
    assert blocked_course_snapshot.status_code == 409

    with session_factory() as db:
        periodic_run = rebuild_periodic_knowledge_snapshots(
            db,
            granularity="day",
            reference_date=date(2036, 7, 16),
            trigger_source="organization_archive_test",
        )
        assert periodic_run.class_snapshot_count == 0
        assert periodic_run.user_snapshot_count == 0
        assert periodic_run.metadata_json["class_course_pairs"] == 0

    blocked_points = client.patch(
        f"/api/points/assignments/{assignment_id}/rule",
        headers=_auth_header(teacher["token"]),
        json={"enabled": True, "points_per_score": 2, "max_points": 40},
    )
    assert blocked_points.status_code == 409

    blocked_class_create = client.post(
        "/api/classes",
        headers=_auth_header(teacher["token"]),
        json={"school_id": school["id"], "name": "Archived School Class"},
    )
    assert blocked_class_create.status_code == 409
    blocked_course_create = client.post(
        "/api/courses",
        headers=_auth_header(teacher["token"]),
        json={"school_id": school["id"], "title": "Archived School Course"},
    )
    assert blocked_course_create.status_code == 409
    blocked_class_restore = _patch_organization(
        client,
        admin,
        "classes",
        class_group["id"],
        {"expected_version": 2, "reason": "parent still archived", "status": "active"},
    )
    assert blocked_class_restore.status_code == 409

    school_read = client.get(
        f"/api/admin/schools/{school['id']}",
        headers=_auth_header(admin["token"]),
    )
    school_stats = client.get(
        f"/api/admin/schools/{school['id']}/stats",
        headers=_auth_header(admin["token"]),
    )
    assert school_read.status_code == school_stats.status_code == 200
    assert school_read.json()["status"] == "archived"

    school_restore = _patch_organization(
        client,
        admin,
        "schools",
        school["id"],
        {"expected_version": 2, "reason": "restore parent", "status": "active"},
    )
    assert school_restore.status_code == 200
    assert school_restore.json()["version"] == 3
    class_restore = _patch_organization(
        client,
        admin,
        "classes",
        class_group["id"],
        {"expected_version": 2, "reason": "restore child", "status": "active"},
    )
    assert class_restore.status_code == 200
    assert class_restore.json()["version"] == 3

    for action in (
        "admin.class.archive",
        "admin.school.archive",
        "admin.school.restore",
        "admin.class.restore",
    ):
        audit = client.get(
            f"/api/admin/audit-logs?action={action}",
            headers=_auth_header(admin["token"]),
        )
        assert audit.status_code == 200
        assert audit.json()["total"] == 1


def test_admin_authority_changes_cannot_orphan_organization_responsibility(client):
    admin = _bootstrap_admin(client)
    teacher = _register_and_login(client, "organization_last_teacher", "teacher")
    school, class_group = _create_organization(client, teacher, "Responsibility")

    orphan_school = client.patch(
        f"/api/admin/users/{teacher['id']}",
        headers=_auth_header(admin["token"]),
        json={"status": "disabled"},
    )
    assert orphan_school.status_code == 409
    assert "school responsible" in orphan_school.json()["detail"]
    teacher_still_active = client.get(
        "/api/users/me",
        headers=_auth_header(teacher["token"]),
    )
    assert teacher_still_active.status_code == 200
    assert teacher_still_active.json()["role"] == "teacher"
    assert teacher_still_active.json()["status"] == "active"
    rejected_audit = client.get(
        f"/api/admin/audit-logs?action=admin.user.update&resource_id={teacher['id']}",
        headers=_auth_header(admin["token"]),
    )
    assert rejected_audit.status_code == 200
    assert rejected_audit.json()["total"] == 0

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        db.add(
            SchoolMembership(
                school_id=school["id"],
                user_id=admin["id"],
                role="admin",
                status="active",
            )
        )
        db.commit()

    orphan_class = client.patch(
        f"/api/admin/users/{teacher['id']}",
        headers=_auth_header(admin["token"]),
        json={"status": "disabled"},
    )
    assert orphan_class.status_code == 409
    assert "class teacher" in orphan_class.json()["detail"]
    assert client.get(
        "/api/users/me",
        headers=_auth_header(teacher["token"]),
    ).status_code == 200
    assert client.get(
        f"/api/admin/audit-logs?action=admin.user.update&resource_id={teacher['id']}",
        headers=_auth_header(admin["token"]),
    ).json()["total"] == 0

    admin_join = client.post(
        f"/api/classes/{class_group['id']}/join",
        headers=_auth_header(admin["token"]),
        json={"role": "teacher"},
    )
    assert admin_join.status_code == 201
    safe_disable = client.patch(
        f"/api/admin/users/{teacher['id']}",
        headers=_auth_header(admin["token"]),
        json={"status": "disabled"},
    )
    assert safe_disable.status_code == 200
    assert safe_disable.json()["status"] == "disabled"

    no_teacher = _register_and_login(client, "organization_no_teacher", "teacher")
    _, no_teacher_class = _create_organization(client, no_teacher, "NoTeacher")
    orphan_school_response = client.post(
        "/api/schools",
        headers=_auth_header(no_teacher["token"]),
        json={"name": "Organization Orphan School"},
    )
    assert orphan_school_response.status_code == 201
    with session_factory() as db:
        school_membership = db.scalar(
            select(SchoolMembership).where(
                SchoolMembership.school_id == orphan_school_response.json()["id"],
                SchoolMembership.user_id == no_teacher["id"],
                SchoolMembership.role == "teacher",
            )
        )
        assert school_membership is not None
        school_membership.status = "inactive"
        membership = db.scalar(
            select(ClassMembership).where(
                ClassMembership.class_id == no_teacher_class["id"],
                ClassMembership.user_id == no_teacher["id"],
                ClassMembership.role == "teacher",
            )
        )
        assert membership is not None
        membership.status = "inactive"
        db.commit()

    archive_without_responsible = _patch_organization(
        client,
        admin,
        "schools",
        orphan_school_response.json()["id"],
        {"expected_version": 1, "reason": "must retain school responsibility", "status": "archived"},
    )
    assert archive_without_responsible.status_code == 409
    assert "active responsible" in archive_without_responsible.json()["detail"]

    archive_without_teacher = _patch_organization(
        client,
        admin,
        "classes",
        no_teacher_class["id"],
        {"expected_version": 1, "reason": "must retain teacher", "status": "archived"},
    )
    assert archive_without_teacher.status_code == 409
    assert "active teacher" in archive_without_teacher.json()["detail"]


@pytest.mark.parametrize(
    ("handler", "required_tokens"),
    [
        (classes.create_class, ("lock_active_school_for_write",)),
        (classes.join_class, ("lock_active_class_for_write",)),
        (classes.transfer_class_teacher, ("lock_active_class_for_write",)),
        (classes.transfer_class_student, ("lock_active_classes_for_write",)),
        (classes.batch_import_class_students, ("lock_active_class_for_write",)),
        (classes.batch_update_class_member_status, ("lock_active_class_for_write",)),
        (classes.update_class_member_status, ("lock_active_class_for_write",)),
        (classes.create_class_join_request, ("lock_active_class_for_write",)),
        (class_join_requests.apply_class_join_request_review, ("lock_active_class_for_write",)),
        (courses.create_course, ("lock_active_school_for_write",)),
        (courses.attach_course_class, ("lock_active_class_for_write",)),
        (courses.transfer_course_owner, ("lock_active_school_for_write",)),
        (courses.create_course_collaborator, ("lock_active_school_for_write",)),
        (courses.batch_update_course_collaborators, ("lock_active_school_for_write",)),
        (courses.update_course_collaborator, ("lock_active_school_for_write",)),
        (courses.create_course_unit, ("lock_active_school_for_write",)),
        (courses.create_assignment, ("lock_active_school_for_write",)),
        (assignment_policies.update_assignment_audience, ("lock_active_school_for_write",)),
        (assignment_policies.put_assignment_class_policy, ("lock_active_class_for_write",)),
        (assignment_policies.delete_assignment_class_policy, ("lock_active_class_for_write",)),
        (points.update_assignment_point_rule, ("lock_active_school_for_write",)),
        (submissions.create_submission, ("require_student_unit_open_for_write",)),
        (submissions.grade_submission, ("lock_active_class_for_write",)),
        (
            learning_events.create_learning_event,
            ("lock_active_class_for_write", "lock_active_school_for_write"),
        ),
        (
            knowledge.rebuild_my_knowledge_snapshot,
            (
                "lock_active_class_for_write",
                "lock_active_school_for_write",
                "lock_active_classes_for_write",
            ),
        ),
        (knowledge.rebuild_class_knowledge_snapshot, ("lock_active_class_for_write",)),
    ],
)
def test_scoped_domain_write_handlers_keep_active_organization_gate(handler, required_tokens):
    source = getsource(handler)
    for required_token in required_tokens:
        assert required_token in source


def test_student_release_write_gate_keeps_active_class_lock():
    source = getsource(
        course_release_write_gate.require_student_unit_open_for_write
    )
    assert "lock_active_class_for_write" in source


@pytest.mark.parametrize(
    "handler",
    [
        schools.create_school,
        classes.create_class,
        classes.join_class,
        classes.transfer_class_teacher,
        classes.batch_update_class_member_status,
        classes.update_class_member_status,
        class_join_requests.apply_class_join_request_review,
    ],
)
def test_teacher_authority_writers_keep_global_serialization_gate(handler):
    source = getsource(handler)
    assert "acquire_security_control_lock" in source
    assert "ADMIN_AUTHORITY_LOCK" in source
