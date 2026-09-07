from __future__ import annotations

from copy import deepcopy

from app.core.config import get_settings
from app.db.session import get_session_factory
from app.api.endpoints import submissions as submission_endpoints
from app.models import (
    Assignment,
    CheckpointAttempt,
    ClassGroup,
    ContentDraft,
    ContentPageVersion,
    Course,
    CourseClassReleaseBinding,
    CourseRelease,
    CourseReleaseUnit,
    CourseUnit,
    CourseUnitClassPlan,
    LearningActivityProjection,
    LearningCompletionRule,
    LearningEvidenceEvent,
    LearningRuleClassBinding,
    SchoolMembership,
    Submission,
)
from sqlalchemy import func, select
from app.services.course_completion import CourseCompletionError

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
        "courseUnit": {
            "courseId": "draft-course",
            "unitId": "draft-unit",
            "order": 1,
            "title": "能量守恒探究",
            "completion": {
                "preset": "checkpoint_passed",
                "checkpointKey": "energy-conservation-check",
            },
        },
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
    assert course_detail.json()["active_student_count"] == 1

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


def test_checkpoint_completion_is_server_graded_idempotent_and_release_bound(client):
    scope = _approved_course_scope(client, "checkpoint_completion")
    course_id = scope["course_id"]
    saved = _replace_draft(
        client,
        scope["owner"]["token"],
        course_id,
        0,
        _unit_payload(_content("检查点完成规则。")),
    )
    assert saved.status_code == 200, saved.json()
    unit_id = saved.json()["units"][0]["id"]
    _enroll_student(
        client,
        student=scope["student"],
        teacher=scope["owner"],
        course_id=course_id,
    )
    published = client.post(
        f"/api/v1/courses/{course_id}/releases",
        headers=_auth(scope["owner"]["token"]),
        json={"expected_revision": 1, "note": "checkpoint completion"},
    )
    assert published.status_code == 201, published.json()
    receipt = published.json()
    release_id = receipt["release"]["id"]
    attempt_url = (
        f"/api/v1/courses/{course_id}/units/{unit_id}/checkpoints/"
        "energy-conservation-check/attempts"
    )

    wrong = client.post(
        attempt_url,
        headers=_auth(scope["student"]["token"]),
        json={
            "client_attempt_id": "checkpoint-attempt-wrong-1",
            "course_release_id": release_id,
            "selected_choice_ids": ["kinetic"],
        },
    )
    assert wrong.status_code == 201, wrong.json()
    assert wrong.json()["is_correct"] is False
    assert wrong.json()["completed"] is False
    assert wrong.json()["remaining_attempts"] == 2
    assert "correctChoiceIds" not in wrong.json()

    correct_payload = {
        "client_attempt_id": "checkpoint-attempt-correct-2",
        "course_release_id": release_id,
        "selected_choice_ids": ["mechanical"],
    }
    correct = client.post(
        attempt_url,
        headers=_auth(scope["student"]["token"]),
        json=correct_payload,
    )
    assert correct.status_code == 201, correct.json()
    assert correct.json()["is_correct"] is True
    assert correct.json()["completed"] is True
    assert correct.json()["remaining_attempts"] == 1
    assert correct.json()["replayed"] is False

    replay = client.post(
        attempt_url,
        headers=_auth(scope["student"]["token"]),
        json=correct_payload,
    )
    assert replay.status_code == 201, replay.json()
    assert replay.json()["id"] == correct.json()["id"]
    assert replay.json()["replayed"] is True
    collision = client.post(
        attempt_url,
        headers=_auth(scope["student"]["token"]),
        json={**correct_payload, "selected_choice_ids": ["potential"]},
    )
    assert collision.status_code == 409, collision.json()
    assert collision.json()["detail"]["code"] == "checkpoint_attempt_id_conflict"

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        attempts = list(
            db.scalars(
                select(CheckpointAttempt).order_by(CheckpointAttempt.attempt_number)
            ).all()
        )
        assert [item.is_correct for item in attempts] == [False, True]
        events = list(
            db.scalars(
                select(LearningEvidenceEvent).where(
                    LearningEvidenceEvent.producer_type == "trusted_assessment"
                )
            ).all()
        )
        assert len(events) == 1
        assert events[0].evidence_json["checkpoint_attempt_id"] == attempts[1].id
        projection = db.scalar(
            select(LearningActivityProjection).where(
                LearningActivityProjection.subject_user_id == scope["student"]["id"],
                LearningActivityProjection.course_unit_id == unit_id,
            )
        )
        assert projection is not None
        assert projection.status == "completed"
        projection.status = "not_started"
        db.commit()

    rebuilt = client.post(
        f"/api/learning-evidence/classes/{scope['internal_class_id']}/courses/{course_id}/rebuild"
        f"?subject_user_id={scope['student']['id']}",
        headers=_auth(scope["admin"]["token"]),
    )
    assert rebuilt.status_code == 200, rebuilt.json()
    with session_factory() as db:
        repaired = db.scalar(
            select(LearningActivityProjection).where(
                LearningActivityProjection.subject_user_id == scope["student"]["id"],
                LearningActivityProjection.course_unit_id == unit_id,
            )
        )
        assert repaired is not None
        assert repaired.status == "completed"

    second_saved = _replace_draft(
        client,
        scope["owner"]["token"],
        course_id,
        receipt["next_draft_revision"],
        _unit_payload(_content("同一规则下的新内容版本。"), unit_id),
    )
    assert second_saved.status_code == 200, second_saved.json()
    second_publish = client.post(
        f"/api/v1/courses/{course_id}/releases",
        headers=_auth(scope["owner"]["token"]),
        json={"expected_revision": second_saved.json()["revision"]},
    )
    assert second_publish.status_code == 201, second_publish.json()
    assert (
        second_publish.json()["release"]["completion_rule_id"]
        == receipt["release"]["completion_rule_id"]
    )
    stale = client.post(
        attempt_url,
        headers=_auth(scope["student"]["token"]),
        json={
            "client_attempt_id": "checkpoint-attempt-stale-release",
            "course_release_id": release_id,
            "selected_choice_ids": ["mechanical"],
        },
    )
    assert stale.status_code == 409, stale.json()
    assert stale.json()["detail"]["code"] == "course_release_stale"


def test_checkpoint_attempt_limit_and_target_mismatch_fail_closed(client):
    scope = _approved_course_scope(client, "checkpoint_limit")
    content = _content("限制次数并拒绝非目标检查点。")
    content["blocks"][3]["maxAttempts"] = 1
    content["blocks"].append(
        {
            "blockId": "secondary-checkpoint",
            "type": "checkpoint",
            "checkpointKey": "secondary-check",
            "title": "非完成目标",
            "prompt": "选择 A",
            "mode": "inline",
            "responseType": "single-choice",
            "choices": [
                {"choiceId": "a", "label": "A"},
                {"choiceId": "b", "label": "B"},
            ],
            "correctChoiceIds": ["a"],
        }
    )
    saved = _replace_draft(
        client,
        scope["owner"]["token"],
        scope["course_id"],
        0,
        _unit_payload(content),
    )
    assert saved.status_code == 200, saved.json()
    unit_id = saved.json()["units"][0]["id"]
    _enroll_student(
        client,
        student=scope["student"],
        teacher=scope["owner"],
        course_id=scope["course_id"],
    )
    published = client.post(
        f"/api/v1/courses/{scope['course_id']}/releases",
        headers=_auth(scope["owner"]["token"]),
        json={"expected_revision": 1},
    )
    assert published.status_code == 201, published.json()
    release_id = published.json()["release"]["id"]
    base = f"/api/v1/courses/{scope['course_id']}/units/{unit_id}/checkpoints"
    mismatch = client.post(
        f"{base}/secondary-check/attempts",
        headers=_auth(scope["student"]["token"]),
        json={
            "client_attempt_id": "checkpoint-nontarget",
            "course_release_id": release_id,
            "selected_choice_ids": ["a"],
        },
    )
    assert mismatch.status_code == 422, mismatch.json()
    assert mismatch.json()["detail"]["code"] == "checkpoint_completion_target_mismatch"
    first = client.post(
        f"{base}/energy-conservation-check/attempts",
        headers=_auth(scope["student"]["token"]),
        json={
            "client_attempt_id": "checkpoint-limit-1",
            "course_release_id": release_id,
            "selected_choice_ids": ["kinetic"],
        },
    )
    assert first.status_code == 201, first.json()
    limited = client.post(
        f"{base}/energy-conservation-check/attempts",
        headers=_auth(scope["student"]["token"]),
        json={
            "client_attempt_id": "checkpoint-limit-2",
            "course_release_id": release_id,
            "selected_choice_ids": ["mechanical"],
        },
    )
    assert limited.status_code == 409, limited.json()
    assert limited.json()["detail"]["code"] == "checkpoint_attempt_limit_reached"


def test_assignment_review_completion_uses_course_teacher_scope_and_is_idempotent(client, monkeypatch):
    scope = _approved_course_scope(client, "assignment_completion")
    course_id = scope["course_id"]
    initial_content = _content("先建立单元，再选择作业。")
    initial_content["courseUnit"].pop("completion")
    initial = _replace_draft(
        client,
        scope["owner"]["token"],
        course_id,
        0,
        _unit_payload(initial_content),
    )
    assert initial.status_code == 200, initial.json()
    unit_id = initial.json()["units"][0]["id"]
    assignment = client.post(
        f"/api/courses/{course_id}/units/{unit_id}/assignments",
        headers=_auth(scope["owner"]["token"]),
        json={"title": "完成报告", "max_score": 20},
    )
    assert assignment.status_code == 201, assignment.json()
    assignment_id = assignment.json()["id"]
    final_content = _content("提交报告并由教师批改后完成。")
    final_content["courseUnit"]["completion"] = {
        "preset": "assignment_reviewed",
        "assignmentId": assignment_id,
    }
    final_saved = _replace_draft(
        client,
        scope["peer"]["token"],
        course_id,
        initial.json()["revision"],
        _unit_payload(final_content, unit_id),
    )
    assert final_saved.status_code == 200, final_saved.json()
    _enroll_student(
        client,
        student=scope["student"],
        teacher=scope["owner"],
        course_id=course_id,
    )
    published = client.post(
        f"/api/v1/courses/{course_id}/releases",
        headers=_auth(scope["peer"]["token"]),
        json={"expected_revision": final_saved.json()["revision"]},
    )
    assert published.status_code == 201, published.json()
    submission = client.post(
        f"/api/assignments/{assignment_id}/submissions",
        headers=_auth(scope["student"]["token"]),
        json={
            "class_id": scope["internal_class_id"],
            "content": {"report": "energy remains conserved"},
        },
    )
    assert submission.status_code == 201, submission.json()
    submission_id = submission.json()["id"]
    peer_scoped_submissions = client.get(
        f"/api/assignments/{assignment_id}/submissions"
        f"?class_id={scope['internal_class_id']}",
        headers=_auth(scope["peer"]["token"]),
    )
    assert peer_scoped_submissions.status_code == 200, peer_scoped_submissions.json()
    assert [item["id"] for item in peer_scoped_submissions.json()] == [submission_id]
    peer_course_submissions = client.get(
        f"/api/assignments/{assignment_id}/submissions",
        headers=_auth(scope["peer"]["token"]),
    )
    assert peer_course_submissions.status_code == 200, peer_course_submissions.json()
    assert [item["id"] for item in peer_course_submissions.json()] == [submission_id]
    original_completion = submission_endpoints.append_assignment_review_completion

    def fail_completion(*_args, **_kwargs):
        raise CourseCompletionError(
            409,
            "forced_completion_failure",
            "forced rollback",
        )

    monkeypatch.setattr(
        submission_endpoints,
        "append_assignment_review_completion",
        fail_completion,
    )
    failed_grade = client.patch(
        f"/api/submissions/{submission_id}/grade",
        headers=_auth(scope["peer"]["token"]),
        json={"score": 17, "feedback": "must roll back", "status": "graded"},
    )
    assert failed_grade.status_code == 409, failed_grade.json()
    assert failed_grade.json()["detail"]["code"] == "forced_completion_failure"
    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        rolled_back = db.get(Submission, submission_id)
        assert rolled_back is not None
        assert rolled_back.status == "submitted"
        assert rolled_back.score is None
        assert db.scalar(
            select(func.count()).select_from(LearningEvidenceEvent).where(
                LearningEvidenceEvent.assignment_id == assignment_id
            )
        ) == 0
    monkeypatch.setattr(
        submission_endpoints,
        "append_assignment_review_completion",
        original_completion,
    )
    grade = client.patch(
        f"/api/submissions/{submission_id}/grade",
        headers=_auth(scope["peer"]["token"]),
        json={"score": 18, "feedback": "已完成", "status": "graded"},
    )
    assert grade.status_code == 200, grade.json()
    regrade = client.patch(
        f"/api/submissions/{submission_id}/grade",
        headers=_auth(scope["owner"]["token"]),
        json={"score": 19, "feedback": "复核完成", "status": "returned"},
    )
    assert regrade.status_code == 200, regrade.json()

    with session_factory() as db:
        trusted = list(
            db.scalars(
                select(LearningEvidenceEvent).where(
                    LearningEvidenceEvent.assignment_id == assignment_id,
                    LearningEvidenceEvent.producer_type == "trusted_assessment",
                )
            ).all()
        )
        assert len(trusted) == 1
        assert trusted[0].evidence_json["submission_id"] == submission_id
        projection = db.scalar(
            select(LearningActivityProjection).where(
                LearningActivityProjection.subject_user_id == scope["student"]["id"],
                LearningActivityProjection.course_unit_id == unit_id,
            )
        )
        assert projection is not None
        assert projection.status == "completed"
        assert db.scalar(select(func.count()).select_from(Submission)) == 1
        assert db.scalar(select(func.count()).select_from(Assignment)) == 1


def test_publication_reuses_rule_and_changes_binding_only_when_completion_changes(client):
    scope = _approved_course_scope(client, "rule_reuse")
    course_id = scope["course_id"]
    first = _replace_draft(
        client,
        scope["owner"]["token"],
        course_id,
        0,
        _unit_payload(_content("规则版本一。")),
    )
    assert first.status_code == 200, first.json()
    unit_id = first.json()["units"][0]["id"]
    first_release = client.post(
        f"/api/v1/courses/{course_id}/releases",
        headers=_auth(scope["owner"]["token"]),
        json={"expected_revision": 1},
    )
    assert first_release.status_code == 201, first_release.json()
    first_receipt = first_release.json()
    unchanged = _replace_draft(
        client,
        scope["owner"]["token"],
        course_id,
        first_receipt["next_draft_revision"],
        _unit_payload(_content("只改正文，不改完成规则。"), unit_id),
    )
    assert unchanged.status_code == 200, unchanged.json()
    second_release = client.post(
        f"/api/v1/courses/{course_id}/releases",
        headers=_auth(scope["owner"]["token"]),
        json={"expected_revision": unchanged.json()["revision"]},
    )
    assert second_release.status_code == 201, second_release.json()
    assert (
        second_release.json()["release"]["completion_rule_id"]
        == first_receipt["release"]["completion_rule_id"]
    )

    changed_content = _content("改用第二个检查点作为完成目标。")
    changed_content["blocks"].append(
        {
            "blockId": "changed-target",
            "type": "checkpoint",
            "checkpointKey": "changed-target-check",
            "title": "新目标",
            "prompt": "选择 B",
            "mode": "inline",
            "responseType": "single-choice",
            "choices": [
                {"choiceId": "a", "label": "A"},
                {"choiceId": "b", "label": "B"},
            ],
            "correctChoiceIds": ["b"],
        }
    )
    changed_content["courseUnit"]["completion"]["checkpointKey"] = "changed-target-check"
    changed = _replace_draft(
        client,
        scope["owner"]["token"],
        course_id,
        second_release.json()["next_draft_revision"],
        _unit_payload(changed_content, unit_id),
    )
    assert changed.status_code == 200, changed.json()
    third_release = client.post(
        f"/api/v1/courses/{course_id}/releases",
        headers=_auth(scope["owner"]["token"]),
        json={"expected_revision": changed.json()["revision"]},
    )
    assert third_release.status_code == 201, third_release.json()
    assert (
        third_release.json()["release"]["completion_rule_id"]
        != first_receipt["release"]["completion_rule_id"]
    )
    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        rules = list(
            db.scalars(
                select(LearningCompletionRule).where(
                    LearningCompletionRule.course_id == course_id
                )
            ).all()
        )
        bindings = list(
            db.scalars(
                select(LearningRuleClassBinding).order_by(
                    LearningRuleClassBinding.plan_version
                )
            ).all()
        )
        assert len(rules) == 2
        assert len(bindings) == 2
        assert [item.plan_version for item in bindings] == [1, 2]


def test_publication_without_completion_config_rolls_back_all_new_facts(client):
    scope = _approved_course_scope(client, "completion_rollback")
    content = _content("未配置完成方式的草稿仍可保存。")
    content["courseUnit"].pop("completion")
    saved = _replace_draft(
        client,
        scope["owner"]["token"],
        scope["course_id"],
        0,
        _unit_payload(content),
    )
    assert saved.status_code == 200, saved.json()
    unit_id = saved.json()["units"][0]["id"]
    rejected = client.post(
        f"/api/v1/courses/{scope['course_id']}/releases",
        headers=_auth(scope["owner"]["token"]),
        json={"expected_revision": saved.json()["revision"]},
    )
    assert rejected.status_code == 409, rejected.json()
    assert rejected.json()["detail"]["code"] == "course_completion_missing"
    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        assert db.scalar(select(func.count()).select_from(CourseRelease)) == 0
        assert db.scalar(select(func.count()).select_from(LearningCompletionRule)) == 0
        assert db.scalar(select(func.count()).select_from(LearningRuleClassBinding)) == 0
        unit = db.get(CourseUnit, unit_id)
        assert unit is not None
        assert unit.status == "draft"


def _completed_workbench_course(client, suffix: str) -> dict:
    scope = _approved_course_scope(client, suffix)
    saved = _replace_draft(
        client, scope["owner"]["token"], scope["course_id"], 0,
        _unit_payload(_content("工作台统计的真实课程样例。")),
    )
    assert saved.status_code == 200, saved.json()
    scope["unit_id"] = saved.json()["units"][0]["id"]
    scope["enrollment"] = _enroll_student(
        client, student=scope["student"], teacher=scope["owner"],
        course_id=scope["course_id"],
    )
    published = client.post(
        f"/api/v1/courses/{scope['course_id']}/releases",
        headers=_auth(scope["owner"]["token"]),
        json={"expected_revision": saved.json()["revision"]},
    )
    assert published.status_code == 201, published.json()
    scope["publication"] = published.json()
    attempted = client.post(
        f"/api/v1/courses/{scope['course_id']}/units/{scope['unit_id']}/"
        "checkpoints/energy-conservation-check/attempts",
        headers=_auth(scope["student"]["token"]),
        json={
            "client_attempt_id": f"metrics-{suffix}",
            "course_release_id": published.json()["release"]["id"],
            "selected_choice_ids": ["mechanical"],
        },
    )
    assert attempted.status_code == 201, attempted.json()
    assert attempted.json()["completed"] is True
    return scope


def test_student_release_reads_obey_opening_policy_without_rewriting_history(client):
    scope = _completed_workbench_course(client, "read_policy")
    course_id = scope["course_id"]
    release_id = scope["publication"]["release"]["id"]
    plan_url = f"/api/courses/{course_id}/classes/{scope['internal_class_id']}/release-plan"
    urls = [f"/api/v1/courses/{course_id}/releases/current", f"/api/v1/courses/{course_id}/releases/{release_id}"]
    for mode in ["locked", "hidden", "open"]:
        plan = client.get(plan_url, headers=_auth(scope["owner"]["token"])).json()
        items = [{key: item[key] for key in ["course_unit_id", "position", "release_mode", "open_at", "prerequisite_unit_id"]} for item in plan["items"]]
        items[0]["release_mode"] = mode
        changed = client.patch(plan_url, headers=_auth(scope["owner"]["token"]), json={"expected_version": plan["plan_version"], "items": items})
        assert changed.status_code == 200, changed.json()
        for url in urls:
            read = client.get(url, headers=_auth(scope["student"]["token"]))
            assert read.status_code == 200, read.json()
            release = read.json().get("release", read.json())
            if mode == "hidden":
                assert release["units"] == []
            else:
                unit = release["units"][0]
                assert unit["access_state"] == mode
                from app.schemas.content_v2 import ContentPageV2
                assert ("工作台统计的真实课程样例。" in str(unit["content"])) == (mode == "open")
                if mode == "locked":
                    ContentPageV2.model_validate(unit["content"])
                    assert unit["media_snapshot"] == []
        teacher = client.get(urls[1], headers=_auth(scope["owner"]["token"])).json()
        assert teacher["units"][0]["content"]["blocks"]
    _assert_workbench_completion(client, scope, completed=1, percent=100)


def _assert_workbench_completion(client, scope: dict, *, completed: int, percent: int):
    admin = client.get("/api/v1/workbench", headers=_auth(scope["admin"]["token"]))
    assert admin.status_code == 200, admin.json()
    snapshot = admin.json()["teaching_snapshot"]
    pulse = next(row for row in snapshot["course_pulse"] if row["course_id"] == scope["course_id"])
    assert pulse["completed_activity_count"] == completed
    assert pulse["progress_percent"] == percent
    assert snapshot["completed_activities"] == completed
    student = client.get("/api/v1/workbench", headers=_auth(scope["student"]["token"]))
    assert student.status_code == 200, student.json()
    course = next((row for row in student.json()["courses"]["items"] if row["course_id"] == scope["course_id"]), None)
    if course is not None:
        assert course["completed_unit_count"] == completed


def test_workbench_completion_excludes_departed_students_without_erasing_history(client):
    scope = _completed_workbench_course(client, "metrics_leave")
    _enroll_student(
        client, student=scope["outsider_student"], teacher=scope["owner"],
        course_id=scope["course_id"],
    )
    _assert_workbench_completion(client, scope, completed=1, percent=50)
    left = client.patch(
        f"/api/v1/courses/{scope['course_id']}/enrollments/{scope['enrollment']['id']}",
        headers=_auth(scope["student"]["token"]),
        json={"status": "left"},
    )
    assert left.status_code == 200, left.json()
    _assert_workbench_completion(client, scope, completed=0, percent=0)
    with get_session_factory(get_settings().database_url)() as db:
        assert db.scalar(select(func.count(LearningActivityProjection.id))) == 1


def test_workbench_completion_uses_current_release_rule_and_retains_same_rule_credit(client):
    scope = _completed_workbench_course(client, "metrics_rule")
    _assert_workbench_completion(client, scope, completed=1, percent=100)
    for change_rule, expected in [(False, 1), (True, 0)]:
        content = _content(f"正文调整，规则变化：{change_rule}")
        if change_rule:
            content["courseUnit"]["completion"]["checkpointKey"] = "new-check"
            content["blocks"][-1]["checkpointKey"] = "new-check"
        saved = _replace_draft(
            client, scope["owner"]["token"], scope["course_id"],
            scope["publication"]["next_draft_revision"],
            _unit_payload(content, scope["unit_id"]),
        )
        assert saved.status_code == 200, saved.json()
        # Unpublished edits do not change the release the student is following.
        _assert_workbench_completion(client, scope, completed=1, percent=100)
        published = client.post(
            f"/api/v1/courses/{scope['course_id']}/releases",
            headers=_auth(scope["owner"]["token"]),
            json={"expected_revision": saved.json()["revision"]},
        )
        assert published.status_code == 201, published.json()
        scope["publication"] = published.json()
        _assert_workbench_completion(client, scope, completed=expected, percent=expected * 100)


def test_workbench_completion_excludes_other_class_projections(client):
    scope = _completed_workbench_course(client, "metrics_scope")
    with get_session_factory(get_settings().database_url)() as db:
        current = db.scalar(select(LearningActivityProjection))
        other = ClassGroup(school_id=scope["school_id"], name="Other homeroom", kind="homeroom", status="active")
        db.add(other)
        db.flush()
        db.add(LearningActivityProjection(
            subject_user_id=current.subject_user_id, school_id=current.school_id,
            class_id=other.id, course_id=current.course_id,
            course_unit_id=current.course_unit_id, activity_key=current.activity_key,
            rule_id=current.rule_id, rule_version=current.rule_version, status="completed",
        ))
        db.commit()
    _assert_workbench_completion(client, scope, completed=1, percent=100)


def test_workbench_completion_excludes_units_removed_from_the_latest_release(client):
    scope = _completed_workbench_course(client, "metrics_units")
    saved = _replace_draft(
        client, scope["owner"]["token"], scope["course_id"],
        scope["publication"]["next_draft_revision"],
        _unit_payload(_content("改用新的学习单元。"), activity_key="physics.mechanics"),
    )
    assert saved.status_code == 200, saved.json()
    with get_session_factory(get_settings().database_url)() as db:
        plans = list(db.scalars(select(CourseUnitClassPlan)).all())
        assert len(plans) == 2
        assert len({plan.position for plan in plans}) == 2
        assert all(plan.position > 0 for plan in plans)
        old_plan = next(plan for plan in plans if plan.course_unit_id == scope["unit_id"])
        assert old_plan.position == 1
        assert old_plan.release_mode == "open"
    _assert_workbench_completion(client, scope, completed=1, percent=100)
    published = client.post(
        f"/api/v1/courses/{scope['course_id']}/releases",
        headers=_auth(scope["owner"]["token"]),
        json={"expected_revision": saved.json()["revision"]},
    )
    assert published.status_code == 201, published.json()
    _assert_workbench_completion(client, scope, completed=0, percent=0)


def test_workbench_completion_counts_transferred_in_both_role_views(client):
    scope = _completed_workbench_course(client, "metrics_transferred")
    with get_session_factory(get_settings().database_url)() as db:
        current = db.scalar(select(LearningActivityProjection).where(
            LearningActivityProjection.class_id == scope["internal_class_id"],
        ))
        current.status = "transferred"
        db.commit()
    _assert_workbench_completion(client, scope, completed=1, percent=100)


def test_draft_removal_does_not_withdraw_current_release_and_history_can_be_restored(client):
    scope = _completed_workbench_course(client, "draft_visibility")
    course_id, old_unit = scope["course_id"], scope["unit_id"]
    old_release = scope["publication"]["release"]
    saved = _replace_draft(client, scope["owner"]["token"], course_id,
        scope["publication"]["next_draft_revision"],
        _unit_payload(_content("新的备课内容"), activity_key="physics.mechanics"))
    assert saved.status_code == 200, saved.json()
    assert [unit["activity_key"] for unit in saved.json()["units"]] == ["physics.mechanics"]
    current = client.get(f"/api/v1/courses/{course_id}/releases/current", headers=_auth(scope["student"]["token"]))
    assert [unit["source_course_unit_id"] for unit in current.json()["release"]["units"]] == [old_unit]
    attempt = client.post(f"/api/v1/courses/{course_id}/units/{old_unit}/checkpoints/energy-conservation-check/attempts", headers=_auth(scope["student"]["token"]), json={"client_attempt_id": "draft-removal-still-current", "course_release_id": old_release["id"], "selected_choice_ids": ["mechanical"]})
    assert attempt.status_code == 201, attempt.json()
    published = client.post(f"/api/v1/courses/{course_id}/releases", headers=_auth(scope["owner"]["token"]), json={"expected_revision": saved.json()["revision"]})
    assert published.status_code == 201, published.json()
    assert [unit["activity_key"] for unit in published.json()["release"]["units"]] == ["physics.mechanics"]
    historic = client.get(f"/api/v1/courses/{course_id}/releases/{old_release['id']}", headers=_auth(scope["student"]["token"]))
    assert [unit["source_course_unit_id"] for unit in historic.json()["units"]] == [old_unit]
    original = old_release["units"][0]
    restored = _replace_draft(client, scope["owner"]["token"], course_id, published.json()["next_draft_revision"], {"id":old_unit,"activity_key":original["activity_key"],"title":original["title"],"position":1,"content":original["content"]})
    assert restored.status_code == 200, restored.json()
    assert restored.json()["units"][0]["id"] == old_unit


def test_saved_learning_activity_identity_cannot_be_reassigned(client):
    scope = _completed_workbench_course(client, "stable_activity")
    original = scope["publication"]["release"]["units"][0]
    changed = _replace_draft(client, scope["owner"]["token"], scope["course_id"], scope["publication"]["next_draft_revision"], {"id":scope["unit_id"],"activity_key":"physics.mechanics","title":"更换身份","position":1,"content":original["content"]})
    assert changed.status_code == 422, changed.json()
    assert changed.json()["detail"]["code"] == "course_unit_identity_immutable"
