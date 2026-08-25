from __future__ import annotations

from copy import deepcopy

from app.core.config import get_settings
from app.db.session import get_session_factory
from app.models import (
    ContentDraft,
    ContentPageVersion,
    Course,
    CourseClassReleaseBinding,
    CourseRelease,
    CourseReleaseUnit,
    SchoolMembership,
)
from sqlalchemy import func, select

PASSWORD = "Course-content-release-123"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Cookie": ""}


def _bootstrap_admin(client, username: str) -> dict:
    created = client.post(
        "/api/admin/bootstrap",
        json={
            "username": username,
            "display_name": username.title(),
            "password": PASSWORD,
        },
    )
    assert created.status_code == 201, created.json()
    logged_in = client.post(
        "/api/auth/login",
        json={"username": username, "password": PASSWORD},
    )
    assert logged_in.status_code == 200, logged_in.json()
    return {"id": created.json()["id"], "token": logged_in.json()["access_token"]}


def _register(client, username: str, role: str) -> dict:
    created = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "display_name": username.replace("_", " ").title(),
            "password": PASSWORD,
            "role": role,
        },
    )
    assert created.status_code == 201, created.json()
    logged_in = client.post(
        "/api/auth/login",
        json={"username": username, "password": PASSWORD},
    )
    assert logged_in.status_code == 200, logged_in.json()
    return {"id": created.json()["id"], "token": logged_in.json()["access_token"]}


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


def _approved_course_scope(client, suffix: str) -> dict:
    admin = _bootstrap_admin(client, f"release_admin_{suffix}")
    owner = _register(client, f"release_owner_{suffix}", "teacher")
    peer = _register(client, f"release_peer_{suffix}", "teacher")
    outsider_teacher = _register(client, f"release_other_teacher_{suffix}", "teacher")
    student = _register(client, f"release_student_{suffix}", "student")
    outsider_student = _register(client, f"release_other_student_{suffix}", "student")
    school = client.post(
        "/api/schools",
        headers=_auth(owner["token"]),
        json={"name": f"Release School {suffix}", "region": "Shanghai"},
    )
    assert school.status_code == 201, school.json()
    school_id = school.json()["id"]
    _grant_school_teacher(peer["id"], school_id)
    created = client.post(
        "/api/v1/courses",
        headers=_auth(owner["token"]),
        json={
            "school_id": school_id,
            "title": f"能量守恒课程 {suffix}",
            "summary": "由共同教师维护并显式发布的课程。",
            "academic_year": "2026—2027",
            "schedule_text": "Wednesday 14:00—15:40",
            "total_hours": 36,
            "galaxy_key": "englab",
            "subject_key": "physics",
            "admission_mode": "open",
            "collaborator_user_ids": [peer["id"]],
            "admission_class_ids": [],
        },
    )
    assert created.status_code == 201, created.json()
    course = created.json()
    submitted = client.post(
        f"/api/v1/courses/{course['id']}/information-revisions/"
        f"{course['information_revision']['id']}/submit",
        headers=_auth(owner["token"]),
    )
    assert submitted.status_code == 200, submitted.json()
    approved = client.patch(
        f"/api/v1/admin/course-information-revisions/{course['information_revision']['id']}",
        headers=_auth(admin["token"]),
        json={"status": "approved", "note": "approved for shared content"},
    )
    assert approved.status_code == 200, approved.json()
    return {
        "admin": admin,
        "owner": owner,
        "peer": peer,
        "outsider_teacher": outsider_teacher,
        "student": student,
        "outsider_student": outsider_student,
        "school_id": school_id,
        "course_id": course["id"],
        "internal_class_id": approved.json()["internal_class_id"],
    }


def _content(markdown: str) -> dict:
    return {
        "schemaVersion": "astra-content-page-v2",
        "slug": "draft/placeholder",
        "galaxy": "englab",
        "subject": "physics",
        "title": "能量守恒探究",
        "summary": "从可视化现象走向守恒关系。",
        "layout": "course-page",
        "status": "draft",
        "version": "draft",
        "blocks": [
            {
                "blockId": "energy-hero",
                "type": "hero",
                "title": "能量去哪了？",
                "summary": "拖动小球并比较势能、动能和总能量。",
                "badges": ["课堂演示", "可交互"],
            },
            {
                "blockId": "energy-reading",
                "type": "rich-text",
                "title": "观察提示",
                "markdown": markdown,
            },
            {
                "blockId": "energy-diagram",
                "type": "media",
                "title": "能量转化示意图",
                "mediaType": "diagram",
                "assetKey": "energy.diagram",
                "alt": "小球下落时势能降低而动能升高的示意图",
                "caption": "课程发布时冻结该媒体摘要。",
            },
            {
                "blockId": "energy-checkpoint",
                "type": "checkpoint",
                "checkpointKey": "energy-conservation-check",
                "title": "即时检查",
                "prompt": "忽略阻力时，小球下落过程中保持不变的是？",
                "mode": "inline",
                "responseType": "single-choice",
                "choices": [
                    {"choiceId": "kinetic", "label": "动能"},
                    {"choiceId": "potential", "label": "重力势能"},
                    {"choiceId": "mechanical", "label": "机械能"},
                ],
                "correctChoiceIds": ["mechanical"],
                "maxAttempts": 3,
            },
        ],
    }


def _unit_payload(
    content: dict,
    unit_id: int | None = None,
    *,
    activity_key: str = "physics.energy-conservation",
    title: str = "能量守恒探究",
    position: int = 1,
) -> dict:
    payload = {
        "activity_key": activity_key,
        "title": title,
        "position": position,
        "content": content,
    }
    if unit_id is not None:
        payload["id"] = unit_id
    return payload


def _replace_draft(client, token: str, course_id: int, revision: int, unit: dict):
    return client.patch(
        f"/api/v1/courses/{course_id}/draft",
        headers=_auth(token),
        json={"expected_revision": revision, "units": [unit]},
    )


def _enroll_student(client, *, student: dict, teacher: dict, course_id: int) -> dict:
    requested = client.post(
        f"/api/v1/courses/{course_id}/join-requests",
        headers=_auth(student["token"]),
        json={"message": "join release course"},
    )
    assert requested.status_code == 201, requested.json()
    approved = client.patch(
        f"/api/v1/courses/{course_id}/join-requests/{requested.json()['id']}",
        headers=_auth(teacher["token"]),
        json={"status": "approved", "note": "approved"},
    )
    assert approved.status_code == 200, approved.json()
    return approved.json()


def test_shared_draft_is_single_across_teachers_and_rejects_stale_writes(client):
    scope = _approved_course_scope(client, "shared")
    course_id = scope["course_id"]
    owner = scope["owner"]
    peer = scope["peer"]

    initial = client.get(
        f"/api/v1/courses/{course_id}/draft",
        headers=_auth(owner["token"]),
    )
    assert initial.status_code == 200, initial.json()
    assert initial.json()["revision"] == 0
    assert initial.json()["units"] == []

    owner_saved = _replace_draft(
        client,
        owner["token"],
        course_id,
        0,
        _unit_payload(_content("第一位教师保存的观察提示。")),
    )
    assert owner_saved.status_code == 200, owner_saved.json()
    assert owner_saved.json()["revision"] == 1
    unit_id = owner_saved.json()["units"][0]["id"]

    peer_read = client.get(
        f"/api/v1/courses/{course_id}/draft",
        headers=_auth(peer["token"]),
    )
    assert peer_read.status_code == 200, peer_read.json()
    assert peer_read.json()["revision"] == 1
    assert (
        "第一位教师" in peer_read.json()["units"][0]["content"]["blocks"][1]["markdown"]
    )

    peer_saved = _replace_draft(
        client,
        peer["token"],
        course_id,
        1,
        _unit_payload(_content("共同教师在同一份草稿上继续修改。"), unit_id),
    )
    assert peer_saved.status_code == 200, peer_saved.json()
    assert peer_saved.json()["revision"] == 2
    assert peer_saved.json()["units"][0]["last_editor_user_id"] == peer["id"]

    stale = _replace_draft(
        client,
        owner["token"],
        course_id,
        1,
        _unit_payload(_content("旧 revision 不得覆盖共同教师内容。"), unit_id),
    )
    assert stale.status_code == 409, stale.json()
    assert stale.json()["detail"]["code"] == "course_draft_revision_conflict"

    outsider = client.get(
        f"/api/v1/courses/{course_id}/draft",
        headers=_auth(scope["outsider_teacher"]["token"]),
    )
    assert outsider.status_code == 403, outsider.json()

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        assert db.get(Course, course_id).content_draft_revision == 2
        active_drafts = list(
            db.scalars(
                select(ContentDraft).where(
                    ContentDraft.course_id == course_id,
                    ContentDraft.active_key == "shared",
                )
            ).all()
        )
        assert len(active_drafts) == 1
        assert active_drafts[0].course_unit_id == unit_id
        assert active_drafts[0].revision == 2
        assert active_drafts[0].last_editor_user_id == peer["id"]


def test_shared_draft_reorders_multiple_units_atomically(client):
    scope = _approved_course_scope(client, "reorder")
    course_id = scope["course_id"]
    created = client.patch(
        f"/api/v1/courses/{course_id}/draft",
        headers=_auth(scope["owner"]["token"]),
        json={
            "expected_revision": 0,
            "units": [
                _unit_payload(_content("单元一。")),
                _unit_payload(
                    _content("单元二。"),
                    activity_key="physics.energy-transfer",
                    title="能量转化探究",
                    position=2,
                ),
            ],
        },
    )
    assert created.status_code == 200, created.json()
    first, second = created.json()["units"]

    reordered = client.patch(
        f"/api/v1/courses/{course_id}/draft",
        headers=_auth(scope["peer"]["token"]),
        json={
            "expected_revision": 1,
            "units": [
                _unit_payload(
                    _content("单元二移到第一位。"),
                    second["id"],
                    activity_key=second["activity_key"],
                    title=second["title"],
                    position=1,
                ),
                _unit_payload(
                    _content("单元一移到第二位。"),
                    first["id"],
                    activity_key=first["activity_key"],
                    title=first["title"],
                    position=2,
                ),
            ],
        },
    )
    assert reordered.status_code == 200, reordered.json()
    assert reordered.json()["revision"] == 2
    assert [item["id"] for item in reordered.json()["units"]] == [
        second["id"],
        first["id"],
    ]


def test_publish_automatically_switches_enrolled_students_and_redacts_answers(client):
    scope = _approved_course_scope(client, "publish")
    course_id = scope["course_id"]
    saved = _replace_draft(
        client,
        scope["owner"]["token"],
        course_id,
        0,
        _unit_payload(_content("首个可发布版本。")),
    )
    assert saved.status_code == 200, saved.json()

    before_enrollment = client.get(
        f"/api/v1/courses/{course_id}/releases/current",
        headers=_auth(scope["student"]["token"]),
    )
    assert before_enrollment.status_code == 403, before_enrollment.json()
    _enroll_student(
        client,
        student=scope["student"],
        teacher=scope["owner"],
        course_id=course_id,
    )

    published = client.post(
        f"/api/v1/courses/{course_id}/releases",
        headers=_auth(scope["peer"]["token"]),
        json={"expected_revision": 1, "note": "首个正式版本"},
    )
    assert published.status_code == 201, published.json()
    receipt = published.json()
    assert receipt["release"]["release_number"] == 1
    assert receipt["release"]["draft_revision"] == 1
    assert receipt["binding"]["binding_revision"] == 1
    assert receipt["binding"]["previous_binding_id"] is None
    assert receipt["next_draft_revision"] == 2
    teacher_checkpoint = receipt["release"]["units"][0]["content"]["blocks"][3]
    assert teacher_checkpoint["correctChoiceIds"] == ["mechanical"]
    assert (
        receipt["release"]["units"][0]["media_snapshot"][0]["asset_key"]
        == "energy.diagram"
    )

    course_detail = client.get(
        f"/api/v1/courses/{course_id}",
        headers=_auth(scope["owner"]["token"]),
    )
    assert course_detail.status_code == 200, course_detail.json()
    assert course_detail.json()["has_published_content"] is True
    assert course_detail.json()["content_status"] == "published"
    assert course_detail.json()["content_status_label"] == "已发布第 1 版"

    student_current = client.get(
        f"/api/v1/courses/{course_id}/releases/current",
        headers=_auth(scope["student"]["token"]),
    )
    assert student_current.status_code == 200, student_current.json()
    assert student_current.json()["release"]["id"] == receipt["release"]["id"]
    student_checkpoint = student_current.json()["release"]["units"][0]["content"][
        "blocks"
    ][3]
    assert "correctChoiceIds" not in student_checkpoint
    assert "numericAnswer" not in student_checkpoint

    outsider = client.get(
        f"/api/v1/courses/{course_id}/releases/current",
        headers=_auth(scope["outsider_student"]["token"]),
    )
    assert outsider.status_code == 403, outsider.json()

    duplicate = client.post(
        f"/api/v1/courses/{course_id}/releases",
        headers=_auth(scope["owner"]["token"]),
        json={"expected_revision": 2, "note": "内容没有变化"},
    )
    assert duplicate.status_code == 409, duplicate.json()
    assert duplicate.json()["detail"]["code"] == "course_release_unchanged"
    stale = client.post(
        f"/api/v1/courses/{course_id}/releases",
        headers=_auth(scope["owner"]["token"]),
        json={"expected_revision": 1, "note": "过期发布"},
    )
    assert stale.status_code == 409, stale.json()
    assert stale.json()["detail"]["code"] == "course_draft_revision_conflict"

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        assert db.scalar(select(func.count()).select_from(CourseRelease)) == 1
        assert db.scalar(select(func.count()).select_from(CourseReleaseUnit)) == 1
        assert (
            db.scalar(select(func.count()).select_from(CourseClassReleaseBinding)) == 1
        )
        assert db.scalar(select(func.count()).select_from(ContentPageVersion)) == 1
        active = db.scalar(
            select(ContentDraft).where(
                ContentDraft.course_id == course_id,
                ContentDraft.active_key == "shared",
            )
        )
        assert active is not None
        assert active.revision == 2
        assert active.base_version_id is not None


def test_second_release_retains_old_history_and_becomes_current_for_students(client):
    scope = _approved_course_scope(client, "history")
    course_id = scope["course_id"]
    first_saved = _replace_draft(
        client,
        scope["owner"]["token"],
        course_id,
        0,
        _unit_payload(_content("版本一：观察总能量曲线。")),
    )
    assert first_saved.status_code == 200, first_saved.json()
    unit_id = first_saved.json()["units"][0]["id"]
    first_publish = client.post(
        f"/api/v1/courses/{course_id}/releases",
        headers=_auth(scope["owner"]["token"]),
        json={"expected_revision": 1, "note": "版本一"},
    )
    assert first_publish.status_code == 201, first_publish.json()
    first_receipt = deepcopy(first_publish.json())
    _enroll_student(
        client,
        student=scope["student"],
        teacher=scope["owner"],
        course_id=course_id,
    )

    second_saved = _replace_draft(
        client,
        scope["peer"]["token"],
        course_id,
        first_receipt["next_draft_revision"],
        _unit_payload(_content("版本二：增加对误差来源的解释。"), unit_id),
    )
    assert second_saved.status_code == 200, second_saved.json()
    assert second_saved.json()["revision"] == 3
    second_publish = client.post(
        f"/api/v1/courses/{course_id}/releases",
        headers=_auth(scope["peer"]["token"]),
        json={"expected_revision": 3, "note": "版本二"},
    )
    assert second_publish.status_code == 201, second_publish.json()
    second_receipt = second_publish.json()
    assert second_receipt["release"]["release_number"] == 2
    assert second_receipt["binding"]["binding_revision"] == 2
    assert (
        second_receipt["binding"]["previous_binding_id"]
        == first_receipt["binding"]["id"]
    )

    current = client.get(
        f"/api/v1/courses/{course_id}/releases/current",
        headers=_auth(scope["student"]["token"]),
    )
    assert current.status_code == 200, current.json()
    assert current.json()["release"]["id"] == second_receipt["release"]["id"]
    assert (
        "版本二"
        in current.json()["release"]["units"][0]["content"]["blocks"][1]["markdown"]
    )

    old = client.get(
        f"/api/v1/courses/{course_id}/releases/{first_receipt['release']['id']}",
        headers=_auth(scope["student"]["token"]),
    )
    assert old.status_code == 200, old.json()
    assert old.json()["release_number"] == 1
    assert "版本一" in old.json()["units"][0]["content"]["blocks"][1]["markdown"]
    assert "correctChoiceIds" not in old.json()["units"][0]["content"]["blocks"][3]

    history = client.get(
        f"/api/v1/courses/{course_id}/releases",
        headers=_auth(scope["owner"]["token"]),
    )
    assert history.status_code == 200, history.json()
    assert [item["release_number"] for item in history.json()] == [2, 1]

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        bindings = list(
            db.scalars(
                select(CourseClassReleaseBinding).order_by(
                    CourseClassReleaseBinding.binding_revision
                )
            ).all()
        )
        assert [item.binding_revision for item in bindings] == [1, 2]
        assert bindings[1].previous_binding_id == bindings[0].id
        versions = list(
            db.scalars(select(ContentPageVersion).order_by(ContentPageVersion.id)).all()
        )
        assert len(versions) == 2
        assert "版本一" in versions[0].schema_json["blocks"][1]["markdown"]
        assert "版本二" in versions[1].schema_json["blocks"][1]["markdown"]
