"""Version-pinned learning, redo barriers, explicit credit and access revocation."""
from uuid import uuid4

from sqlalchemy import func, select

from app.core.config import get_settings
from app.db.session import get_session_factory
from app.models import CheckpointAttempt, LearningContext, LearningResult, LearningResultRecognition
from test_content_platform_api import _approved_course_scope, _auth, _enroll_student
from test_course_workflow_v2 import make_course, read_draft, request, review, publish, save, unit


def release_draft(client, scope, draft, policies=None):
    command = {"source_revision": draft["revision"], "source_state_token": draft["state_token"]}
    shown = request(client, "POST", f"/courses/{draft['course_id']}/submission-preview", scope["owner"]["token"], command)
    sent = request(client, "POST", f"/courses/{draft['course_id']}/submissions", scope["owner"]["token"], {**command, "preview_token": shown["preview_token"], "client_request_id": uuid4().hex, "result_policies": {str(draft["course_id"]): policies or {}}}, 201)
    return publish(client, scope, review(client, scope, sent["items"])["items"])["items"][0]["release"]


def setup(client, suffix, count=1):
    scope = _approved_course_scope(client, suffix)
    course = make_course(client, scope)
    draft = save(client, scope, read_draft(client, scope, course["id"]), [unit(f"单元 {index + 1}", index + 1, "第一版内容") for index in range(count)])
    publication = release_draft(client, scope, draft)
    enrollment = _enroll_student(client, student=scope["student"], teacher=scope["owner"], course_id=course["id"])
    return scope, course, draft, publication, enrollment


def start(client, scope, release, unit_id, *, status=201, token=None):
    return request(client, "POST", "/learning-contexts", token or scope["student"]["token"], {"client_request_id": uuid4().hex, "mode": "formal", "course_id": release["course_id"], "course_unit_id": unit_id, "expected_release_id": release["id"]}, status)


def answer(client, scope, context, *, choice="mechanical", key=None, status=201, checkpoint="energy-conservation-check"):
    return request(client, "POST", f"/learning-contexts/{context['context_key']}/checkpoints/{checkpoint}", scope["student"]["token"], {"client_attempt_id": key or uuid4().hex, "selected_choice_ids": [choice]}, status)


def completed(client, scope, course_id):
    response = client.get("/api/v1/workbench", headers=_auth(scope["student"]["token"]))
    assert response.status_code == 200, response.text
    return next(item["completed_unit_count"] for item in response.json()["courses"]["items"] if item["course_id"] == course_id)


def test_running_old_version_can_finish_but_redo_prevents_current_credit(client):
    scope, course, draft, first, _ = setup(client, "context_redo")
    unit_id = draft["units"][0]["id"]
    context = start(client, scope, first, unit_id)
    assert context["records_course_results"] and context["course_release_id"] == first["id"]
    assert "correctChoiceIds" not in context["content"]["blocks"][-1]
    assert context["content_schema_sha256"] != first["units"][0]["content_schema_sha256"]
    public = client.get(f"/api/v1/courses/{course['id']}/releases/current", headers=_auth(scope["student"]["token"])).json()["release"]
    assert public["package_sha256"] != first["package_sha256"]
    assert public["units"][0]["content_schema_sha256"] == context["content_schema_sha256"]
    draft = read_draft(client, scope, course["id"])
    draft["units"][0]["content"]["blocks"][-1]["correctChoiceIds"] = ["kinetic"]
    draft = save(client, scope, draft)
    second = release_draft(client, scope, draft, {str(unit_id): "redo"})
    start(client, scope, first, unit_id, status=409)
    reread = request(client, "GET", f"/learning-contexts/{context['context_key']}", scope["student"]["token"])
    assert reread["newer_release_available"] and reread["course_release_id"] == first["id"]
    old = answer(client, scope, context)
    assert old["is_correct"] and old["completed"] and not old["current_version_completed"]
    assert completed(client, scope, course["id"]) == 0
    current = start(client, scope, second, unit_id)
    outcome = answer(client, scope, current, choice="kinetic")
    assert outcome["current_version_completed"] and completed(client, scope, course["id"]) == 1
    with get_session_factory(get_settings().database_url)() as db:
        assert db.scalar(select(func.count()).select_from(CheckpointAttempt)) == 2
        assert db.scalar(select(func.count()).select_from(LearningResultRecognition)) == 0


def test_unchanged_unit_keeps_credit_when_another_unit_changes_the_course_rule(client):
    scope, course, draft, first, _ = setup(client, "context_keep", 2)
    a, b = (item["id"] for item in draft["units"])
    answer(client, scope, start(client, scope, first, a))
    answer(client, scope, start(client, scope, first, b))
    assert completed(client, scope, course["id"]) == 2
    draft = read_draft(client, scope, course["id"])
    page = draft["units"][1]["content"]
    page["blocks"][-1]["checkpointKey"] = "new-target"
    page["courseUnit"]["completion"]["checkpointKey"] = "new-target"
    draft = save(client, scope, draft)
    second = release_draft(client, scope, draft, {str(b): "redo"})
    assert first["completion_rule_id"] != second["completion_rule_id"]
    assert completed(client, scope, course["id"]) == 1
    with get_session_factory(get_settings().database_url)() as db:
        recognition = db.scalar(select(LearningResultRecognition))
        assert recognition.target_release_id == second["id"] and recognition.course_unit_id == a
        assert db.scalar(select(func.count()).select_from(CheckpointAttempt)) == 2


def test_late_completion_is_recognized_once_and_does_not_cross_a_later_redo(client):
    scope, course, draft, first, _ = setup(client, "context_late")
    unit_id = draft["units"][0]["id"]
    context = start(client, scope, first, unit_id)
    draft = read_draft(client, scope, course["id"])
    draft["units"][0]["content"]["blocks"][1]["markdown"] = "只增加说明"
    second = release_draft(client, scope, save(client, scope, draft))
    key = uuid4().hex
    outcome = answer(client, scope, context, key=key)
    assert outcome["course_release_id"] == first["id"] and outcome["current_version_completed"]
    replay = answer(client, scope, context, key=key)
    assert replay["replayed"] and replay["id"] == outcome["id"] and replay["result_id"] == outcome["result_id"]
    draft = read_draft(client, scope, course["id"])
    draft["units"][0]["content"]["blocks"][-1]["prompt"] += "（补充条件）"
    third = release_draft(client, scope, save(client, scope, draft), {str(unit_id): "redo"})
    answer(client, scope, context)
    assert completed(client, scope, course["id"]) == 0
    with get_session_factory(get_settings().database_url)() as db:
        assert set(db.scalars(select(LearningResultRecognition.target_release_id))) == {second["id"]}
        assert third["id"] not in set(db.scalars(select(LearningResultRecognition.target_release_id)))


def test_context_does_not_bypass_revocation_or_turn_exploration_into_a_grade(client):
    scope, course, draft, first, enrollment = setup(client, "context_access")
    unit_id = draft["units"][0]["id"]
    start(client, scope, first, unit_id, token=scope["outsider_student"]["token"], status=403)
    context = start(client, scope, first, unit_id)
    request(client, "GET", f"/learning-contexts/{context['context_key']}", scope["outsider_student"]["token"], status=404)
    request(client, "POST", "/resources/install-system", scope["admin"]["token"])
    resource = request(client, "GET", "/resources?kind=template", scope["student"]["token"])["items"][0]
    explore = request(client, "POST", "/learning-contexts", scope["student"]["token"], {"client_request_id": uuid4().hex, "mode": "explore", "resource_version_id": resource["id"]}, 201)
    assert not explore["records_course_results"] and explore["course_release_id"] is None
    answer(client, scope, explore, status=403)
    request(client, "POST", "/learning-contexts", scope["student"]["token"], {"client_request_id": uuid4().hex, "mode": "preview", "resource_version_id": resource["id"]}, 403)
    revoked = client.patch(f"/api/v1/courses/{course['id']}/enrollments/{enrollment['id']}", headers=_auth(scope["owner"]["token"]), json={"status": "left"})
    assert revoked.status_code == 200, revoked.text
    answer(client, scope, context, status=403)
    request(client, "GET", f"/learning-contexts/{context['context_key']}", scope["student"]["token"], status=403)
    with get_session_factory(get_settings().database_url)() as db:
        assert db.scalar(select(func.count()).select_from(CheckpointAttempt)) == 0
        assert db.scalar(select(func.count()).select_from(LearningResult)) == 0


def test_noncompletion_checkpoint_is_graded_without_claiming_unit_completion(client):
    scope = _approved_course_scope(client, "context_practice")
    course = make_course(client, scope)
    lesson = unit("多个检查点", 1, "练习与完成条件分开")
    extra = dict(lesson["content"]["blocks"][-1], blockId="extra-check", checkpointKey="practice")
    lesson["content"]["blocks"].append(extra)
    draft = save(client, scope, read_draft(client, scope, course["id"]), [lesson])
    release = release_draft(client, scope, draft)
    _enroll_student(client, student=scope["student"], teacher=scope["owner"], course_id=course["id"])
    context = start(client, scope, release, draft["units"][0]["id"])
    result = answer(client, scope, context, checkpoint="practice")
    assert result["is_correct"] and not result["completed"] and not result["current_version_completed"]
    assert completed(client, scope, course["id"]) == 0


def test_old_context_uses_old_prerequisite_credit_but_still_obeys_manual_lock(client):
    scope, course, draft, first, _ = setup(client, "context_prerequisite", 2)
    a, b = (item["id"] for item in draft["units"])
    ca = start(client, scope, first, a)
    answer(client, scope, ca)
    url = f"/api/courses/{course['id']}/classes/{ca['class_id']}/release-plan"
    plan = client.get(url, headers=_auth(scope["owner"]["token"])).json()
    fields = {"course_unit_id", "position", "release_mode", "open_at", "prerequisite_unit_id"}
    items = [{key: value for key, value in item.items() if key in fields} for item in plan["items"]]
    next(item for item in items if item["course_unit_id"] == b)["prerequisite_unit_id"] = a
    changed = client.patch(url, headers=_auth(scope["owner"]["token"]), json={"expected_version": plan["plan_version"], "items": items})
    assert changed.status_code == 200, changed.text
    cb = start(client, scope, first, b)
    draft = read_draft(client, scope, course["id"])
    draft["units"][0]["content"]["blocks"][-1]["prompt"] += "（补做）"
    second = release_draft(client, scope, save(client, scope, draft), {str(a): "redo"})
    start(client, scope, second, b, status=409)
    assert answer(client, scope, cb)["is_correct"]
    plan = client.get(url, headers=_auth(scope["owner"]["token"])).json()
    items = [{key: value for key, value in item.items() if key in fields} for item in plan["items"]]
    next(item for item in items if item["course_unit_id"] == b)["release_mode"] = "hidden"
    changed = client.patch(url, headers=_auth(scope["owner"]["token"]), json={"expected_version": plan["plan_version"], "items": items})
    assert changed.status_code == 200, changed.text
    answer(client, scope, cb, status=403)


def test_own_result_history_survives_leaving_without_returning_answer_keys(client):
    scope, course, draft, first, enrollment = setup(client, "context_history")
    context = start(client, scope, first, draft["units"][0]["id"])
    answer(client, scope, context)
    history = request(client, "GET", f"/courses/{course['id']}/learning-results", scope["student"]["token"])
    assert history["total"] == 1 and history["items"][0]["is_correct"]
    assert history["items"][0]["response"] == {"selected_choice_ids": ["mechanical"]}
    assert "correctChoiceIds" not in str(history)
    request(client, "GET", f"/courses/{course['id']}/learning-results?student_id={scope['student']['id']}", scope["outsider_student"]["token"], status=403)
    left = client.patch(f"/api/v1/courses/{course['id']}/enrollments/{enrollment['id']}", headers=_auth(scope["owner"]["token"]), json={"status": "left"})
    assert left.status_code == 200, left.text
    own = request(client, "GET", f"/courses/{course['id']}/learning-results", scope["student"]["token"])
    assert own["total"] == 1 and not own["can_read_course"] and own["current_release_id"] is None
    request(client, "GET", f"/learning-contexts/{context['context_key']}", scope["student"]["token"], status=403)
