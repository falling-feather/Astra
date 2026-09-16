"""Formal parameter observations keep their publication, authority and cursor identity."""
from copy import deepcopy
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.core.config import get_settings
from app.db.session import get_session_factory
from app.models import CourseEnrollment, LearningActivityRuntime, LearningEvidenceEvent, LearningResult
from test_content_platform_api import _approved_course_scope, _auth, _enroll_student
from test_course_workflow_v2 import make_course, read_draft, request, save, unit
from test_learning_contexts_v2 import completed, release_draft, start
from test_learning_evidence import _activity_runtime_event_payload


def setup(client, suffix):
    scope = _approved_course_scope(client, suffix)
    request(client, "POST", "/resources/install-system", scope["admin"]["token"])
    resource = next(row for row in request(client, "GET", "/resources?kind=template", scope["owner"]["token"])["items"] if row["resource_key"] == "template.function-graph")
    course = make_course(client, scope)
    lesson = unit("参数与图像", 1, "改变二次项系数，观察曲线变化")
    lesson["content"]["blocks"].append({"blockId": "graph", "type": "resource", "title": resource["title"], "resourceVersionId": resource["id"], "configuration": resource["definition"]["configuration"], "instructions": "改变参数并记录观察"})
    lesson["content"]["courseUnit"]["completion"] = {"preset": "experiment_operation"}
    draft = save(client, scope, read_draft(client, scope, course["id"]), [lesson])
    release = release_draft(client, scope, draft)
    _enroll_student(client, student=scope["student"], teacher=scope["owner"], course_id=course["id"])
    context = start(client, scope, release, draft["units"][0]["id"])
    config = request(client, "GET", f"/learning-contexts/{context['context_key']}/activity-runtime", scope["student"]["token"])
    return scope, course, draft, release, context, config


def identity(config):
    return {**config["scope"], **{key: config[key] for key in ["subject_identity", "manifest_version", "content_version", "event_schema_version", "rule_version", "generation"]}, "run_id": uuid4().hex, "group_id": uuid4().hex}


def payload(config, run, sequence, value=None):
    observation = {"block_id": "graph", "parameter": "a", "value": value}
    body = _activity_runtime_event_payload({}, identity=run, client_event_id=uuid4().hex, sequence=sequence, event_type="started" if value is None else "attempted", evidence={} if value is None else {"operation": "parameter-change", "cursor": observation}, snapshot={"last_observation": None if value is None else deepcopy(observation)})
    body["snapshot"]["state_schema_version"] = config["state_schema_version"]
    return body


def event(client, scope, config, body, status=201):
    return request(client, "POST", f"/learning-contexts/{config['context_key']}/activity-runtime/events", scope["student"]["token"], body, status)


def recovery(client, scope, config, run, status=200):
    return request(client, "POST", f"/learning-contexts/{config['context_key']}/activity-runtime/recovery", scope["student"]["token"], run, status)


def test_running_observation_finishes_old_release_without_crossing_redo(client):
    scope, course, draft, first, context, config = setup(client, "runtime_context_redo")
    run = identity(config)
    event(client, scope, config, payload(config, run, 1))
    draft = read_draft(client, scope, course["id"])
    draft["units"][0]["content"]["blocks"][-1]["configuration"]["parameters"][0]["maximum"] = 1
    second = release_draft(client, scope, save(client, scope, draft), {str(draft["units"][0]["id"]): "redo"})
    finished = event(client, scope, config, payload(config, run, 2, 2))
    assert finished["learner_sequence"] == 2 and finished["server_last_sequence"] == 3
    assert completed(client, scope, course["id"]) == 0
    old = recovery(client, scope, config, run)
    assert old["exact_available"] and old["server"]["projection"]["state"] == "completed"
    assert old["server"]["snapshot"]["data"]["last_observation"]["value"] == 2
    current = start(client, scope, second, draft["units"][0]["id"])
    new_config = request(client, "GET", f"/learning-contexts/{current['context_key']}/activity-runtime", scope["student"]["token"])
    new_run = identity(new_config)
    event(client, scope, new_config, payload(new_config, new_run, 1))
    event(client, scope, new_config, payload(new_config, new_run, 2, 2), 422)
    event(client, scope, new_config, payload(new_config, new_run, 2, .5))
    assert completed(client, scope, course["id"]) == 1
    history = request(client, "GET", f"/courses/{course['id']}/learning-results", scope["student"]["token"])
    recorded = next(row for row in history["items"] if row["source_release_id"] == first["id"] and row["response"].get("数值") == 2)
    assert recorded["response"]["参数"] == "二次项系数" and not recorded["current_credit"]
    assert "-3" in recorded["prompt"] and "3" in recorded["prompt"]
    with get_session_factory(get_settings().database_url)() as db:
        assert db.scalar(select(func.count()).select_from(LearningActivityRuntime)) == 2
        assert set(db.scalars(select(LearningResult.course_release_id))) == {first["id"], second["id"]}


def test_runtime_receipts_are_idempotent_and_cannot_be_rebound_to_another_context(client):
    scope, course, draft, release, _, config = setup(client, "runtime_context_identity")
    run = identity(config)
    first = payload(config, run, 1)
    event(client, scope, config, first)
    assert event(client, scope, config, first)["status"] == "reconciled"
    event(client, scope, config, payload(config, run, 3, 1), 409)
    other = start(client, scope, release, draft["units"][0]["id"])
    other_config = request(client, "GET", f"/learning-contexts/{other['context_key']}/activity-runtime", scope["student"]["token"])
    rebound = {**identity(other_config), "run_id": run["run_id"], "group_id": run["group_id"]}
    event(client, scope, other_config, payload(other_config, rebound, 2, 1), 409)
    tampered = payload(config, run, 2, 1)
    tampered["command"]["scope"]["course_unit_id"] += 100
    event(client, scope, config, tampered, 403)
    legacy = client.post("/api/learning-evidence/activity-runtime/events", headers=_auth(scope["student"]["token"]), json=payload(config, run, 2, 1))
    assert legacy.status_code == 409 and legacy.json()["detail"]["code"] == "learning_context_required"
    event(client, scope, config, payload(config, run, 2, 1))
    with get_session_factory(get_settings().database_url)() as db:
        assert db.scalar(select(func.count()).select_from(LearningActivityRuntime)) == 1
        assert db.scalar(select(func.count()).select_from(LearningEvidenceEvent)) == 3
        runtime = db.scalar(select(LearningActivityRuntime))
        runtime.learning_context_id = None
        with pytest.raises(ValueError, match="identity is immutable"):
            db.commit()
        db.rollback()
        source_event = db.scalar(select(LearningEvidenceEvent.id).where(LearningEvidenceEvent.event_type == "attempted"))
    correction = client.post(f"/api/learning-evidence/events/{source_event}/corrections", headers=_auth(scope["owner"]["token"]), json={"client_event_id": uuid4().hex, "reason": "核对后撤销这次误记录的操作", "occurred_at": datetime.now(UTC).isoformat()})
    assert correction.status_code == 201, correction.text
    assert completed(client, scope, course["id"]) == 0
    assert recovery(client, scope, config, run)["manual_intervention_required"]


def test_parameter_rules_and_recovery_access_are_enforced(client):
    scope, course, _, _, context, config = setup(client, "runtime_context_access")
    run = identity(config)
    event(client, scope, config, payload(config, run, 1))
    unknown = payload(config, run, 2, 1)
    unknown["command"]["evidence"]["cursor"]["parameter"] = "teacher-answer"
    rejected = event(client, scope, config, unknown, 422)
    assert "参数" in rejected["detail"]
    wrong_snapshot = payload(config, run, 2, 1)
    wrong_snapshot["snapshot"]["data"]["last_observation"]["value"] = 3
    event(client, scope, config, wrong_snapshot, 422)
    unauthorized = request(client, "POST", f"/learning-contexts/{context['context_key']}/activity-runtime/authority", scope["outsider_student"]["token"], run, 403)
    forged_actor = {**run, "subject_identity": {"kind": "learner", "id": str(scope["outsider_student"]["id"])}}
    request(client, "POST", f"/learning-contexts/{context['context_key']}/activity-runtime/authority", scope["student"]["token"], forged_actor, 403)
    with get_session_factory(get_settings().database_url)() as db:
        enrollment = db.scalar(select(CourseEnrollment).where(CourseEnrollment.course_id == course["id"], CourseEnrollment.student_id == scope["student"]["id"]))
        enrollment.status = "left"
        db.commit()
    event(client, scope, config, payload(config, run, 2, 1), 403)
    recovery(client, scope, config, run, 403)


def test_runtime_result_failure_rolls_back_facts_cursors_and_retry(client, monkeypatch):
    from app.services import activity_contexts
    scope, _, _, _, _, config = setup(client, "runtime_context_transaction")
    run = identity(config)
    first = payload(config, run, 1)
    original = activity_contexts.record_runtime_results
    def fail(*args, **kwargs):
        from fastapi import HTTPException
        raise HTTPException(status_code=409, detail="模拟结果入库冲突")
    monkeypatch.setattr(activity_contexts, "record_runtime_results", fail)
    event(client, scope, config, first, 409)
    with get_session_factory(get_settings().database_url)() as db:
        assert db.scalar(select(func.count()).select_from(LearningActivityRuntime)) == 0
        assert db.scalar(select(func.count()).select_from(LearningEvidenceEvent)) == 0
    monkeypatch.setattr(activity_contexts, "record_runtime_results", original)
    event(client, scope, config, first)
    assert recovery(client, scope, config, run)["server"]["event_count"] == 1
