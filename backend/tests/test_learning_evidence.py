from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
import hashlib
import json
import os
from pathlib import Path
from threading import Barrier, Event
from uuid import uuid4

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.dialects import mysql
from sqlalchemy.schema import CreateIndex, CreateTable

from app.core.config import get_settings
from app.core.learning_evidence_contract import (
    MAX_RULE_WITNESS_EVENTS,
    RULE_DERIVED_CLIENT_EVENT_PREFIX,
)
from app.db.session import get_session_factory, make_engine, reset_database_state
from app.main import create_app
from app.models import (
    Assignment,
    AuditLog,
    ClassMembership,
    Course,
    CourseCollaborator,
    CourseUnit,
    LegacyAccessEntitlement,
    LearningActivityProjection,
    LearningCompletionRule,
    LearningEvidenceEvent,
    LearningEvent,
    LearningResumeProjection,
    LearningRuleActivation,
    LearningRuleClassBinding,
    SchoolMembership,
    User,
)
from app.schemas.learning_evidence import (
    CompletionRuleActivate,
    LearnerEvidenceEventCreate,
    MAX_EVIDENCE_BYTES,
    TeacherEvidenceCorrectionCreate,
)
from app.models.learning_evidence import CURRENT_EVENT_SCHEMA_VERSION
from app.services.learning_evidence import (
    LearningEvidenceError,
    activate_completion_rule,
    append_learner_event,
    append_teacher_correction,
    append_trusted_assessment_result,
    rebuild_learning_projections,
)
from app.services import (
    assignment_policies,
    course_release_plans,
    course_release_write_gate,
)
from app.services import learning_evidence as learning_evidence_service
from app.services import learning_evidence_access
from app.services import learning_evidence_projection
from app.services.access_control import lock_active_school_for_write
from app.services.learning_evidence_projection import ActivityProjectionScope


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Cookie": ""}


def _assert_explicit_utc(value: str) -> None:
    assert value.endswith("Z") or value.endswith("+00:00")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    assert parsed.utcoffset() == timedelta(0)


def _login(client, username: str, role: str) -> dict:
    password = "Learning-evidence-test-password-123"
    registered = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "display_name": username,
            "password": password,
            "role": role,
        },
    )
    assert registered.status_code == 201, registered.json()
    logged_in = client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    assert logged_in.status_code == 200
    token = logged_in.json()["access_token"]
    me = client.get("/api/users/me", headers=_auth(token))
    assert me.status_code == 200
    return {"id": me.json()["id"], "token": token, "username": username, "password": password}


def _login_again(client, identity: dict) -> str:
    logged_in = client.post(
        "/api/auth/login",
        json={"username": identity["username"], "password": identity["password"]},
    )
    assert logged_in.status_code == 200
    return logged_in.json()["access_token"]


def _learning_scope(client, slug: str = "default") -> dict:
    teacher = _login(client, f"le_teacher_{slug}", "teacher")
    student = _login(client, f"le_student_{slug}", "student")
    other_student = _login(client, f"le_other_student_{slug}", "student")
    outsider_teacher = _login(client, f"le_outsider_teacher_{slug}", "teacher")
    school = client.post(
        "/api/schools",
        headers=_auth(teacher["token"]),
        json={"name": f"Learning Evidence School {slug}", "region": "Shanghai"},
    )
    assert school.status_code == 201, school.json()
    school_id = school.json()["id"]
    class_response = client.post(
        "/api/classes",
        headers=_auth(teacher["token"]),
        json={"school_id": school_id, "name": f"Learning Evidence Class {slug}"},
    )
    assert class_response.status_code == 201, class_response.json()
    class_id = class_response.json()["id"]
    course = client.post(
        "/api/courses",
        headers=_auth(teacher["token"]),
        json={
            "school_id": school_id,
            "galaxy_key": "englab",
            "course_key": f"learning-evidence-{slug}",
            "title": f"Learning Evidence Course {slug}",
            "status": "published",
        },
    )
    assert course.status_code == 201, course.json()
    course_id = course.json()["id"]
    attached = client.post(
        f"/api/courses/{course_id}/classes",
        headers=_auth(teacher["token"]),
        json={"class_id": class_id},
    )
    assert attached.status_code == 201, attached.json()
    units = []
    for position, activity_key in (
        (1, f"evidence.{slug}-foundation"),
        (2, f"evidence.{slug}-transfer"),
    ):
        response = client.post(
            f"/api/courses/{course_id}/units",
            headers=_auth(teacher["token"]),
            json={
                "title": f"Evidence unit {position}",
                "position": position,
                "activity_key": activity_key,
                "status": "published",
            },
        )
        assert response.status_code == 201, response.json()
        units.append(response.json())
    for identity in (student, other_student):
        joined = client.post(
            f"/api/classes/{class_id}/join",
            headers=_auth(identity["token"]),
            json={"role": "student"},
        )
        assert joined.status_code == 201, joined.json()
    return {
        "teacher": teacher,
        "student": student,
        "other_student": other_student,
        "outsider_teacher": outsider_teacher,
        "school_id": school_id,
        "class_id": class_id,
        "course_id": course_id,
        "unit_one": units[0],
        "unit_two": units[1],
    }


def _rule_payload(scope: dict) -> dict:
    return {
        "course_id": scope["course_id"],
        "activities": [
            {
                "activity_key": scope["unit_one"]["activity_key"],
                "outcome": "completed",
                "required_event_types": ["started", "attempted"],
                "minimum_attempts": 1,
            },
            {
                "activity_key": scope["unit_two"]["activity_key"],
                "outcome": "transferred",
                "required_event_types": ["explained"],
            },
        ],
    }


def _create_rule(client, scope: dict, token: str | None = None) -> dict:
    response = client.post(
        "/api/learning-evidence/rules",
        headers=_auth(token or scope["teacher"]["token"]),
        json=_rule_payload(scope),
    )
    assert response.status_code == 201, response.json()
    return response.json()


def _activate_rule(
    client,
    scope: dict,
    rule: dict,
    *,
    expected_revision: int = 0,
    expected_plan_version: int = 1,
    token: str | None = None,
) -> dict:
    response = client.post(
        f"/api/learning-evidence/rules/{rule['id']}/activate",
        headers=_auth(token or scope["teacher"]["token"]),
        json={
            "expected_revision": expected_revision,
            "class_bindings": [
                {
                    "class_id": scope["class_id"],
                    "expected_plan_version": expected_plan_version,
                }
            ],
        },
    )
    assert response.status_code == 200, response.json()
    return response.json()


def _event_payload(
    scope: dict,
    *,
    client_event_id: str,
    event_type: str,
    occurred_at: datetime,
    unit: str = "unit_one",
    evidence: dict | None = None,
    rule_version: int = 1,
) -> dict:
    selected = scope[unit]
    return {
        "client_event_id": client_event_id,
        "class_id": scope["class_id"],
        "course_id": scope["course_id"],
        "course_unit_id": selected["id"],
        "activity_key": selected["activity_key"],
        "rule_version": rule_version,
        "event_type": event_type,
        "evidence": evidence or {},
        "occurred_at": occurred_at.isoformat(),
    }


def test_rule_permissions_version_cas_binding_and_immutability(client):
    scope = _learning_scope(client, "rule")
    assessment_editor = _login(client, "le_assessment_editor", "teacher")
    with get_session_factory(get_settings().database_url)() as db:
        db.add(
            SchoolMembership(
                school_id=scope["school_id"],
                user_id=assessment_editor["id"],
                role="teacher",
                status="active",
            )
        )
        db.commit()
    collaborator = client.post(
        f"/api/courses/{scope['course_id']}/collaborators",
        headers=_auth(scope["teacher"]["token"]),
        json={"user_id": assessment_editor["id"], "role": "assessment_editor"},
    )
    assert collaborator.status_code == 201, collaborator.json()
    criterion_typo = client.post(
        "/api/learning-evidence/rules",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "course_id": scope["course_id"],
            "activities": [
                {
                    "activity_key": scope["unit_one"]["activity_key"],
                    "outcome": "completed",
                    "required_event_types": ["started", "attempted"],
                    "minimum_atempts": 1,
                }
            ],
        },
    )
    assert criterion_typo.status_code == 422
    with get_session_factory(get_settings().database_url)() as db:
        assert (
            db.scalar(
                select(text("count(*)")).select_from(LearningCompletionRule)
            )
            == 0
        )
    for activities in (
        [
            {
                "activity_key": scope["unit_one"]["activity_key"],
                "outcome": "completed",
                "required_event_types": ["started"],
            }
        ],
        [
            {
                "activity_key": scope["unit_one"]["activity_key"],
                "outcome": "completed",
                "required_event_types": ["attempted"],
                "minimum_attempts": 1,
            }
        ],
    ):
        degenerate = client.post(
            "/api/learning-evidence/rules",
            headers=_auth(scope["teacher"]["token"]),
            json={"course_id": scope["course_id"], "activities": activities},
        )
        assert degenerate.status_code == 422
        assert "completed rules require multiple fact types" in degenerate.text
    learner_correctness_rule = client.post(
        "/api/learning-evidence/rules",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "course_id": scope["course_id"],
            "activities": [
                {
                    "activity_key": scope["unit_one"]["activity_key"],
                    "outcome": "completed",
                    "required_event_types": ["started", "attempted"],
                    "minimum_attempts": 1,
                    "minimum_correct_attempts": 1,
                }
            ],
        },
    )
    assert learner_correctness_rule.status_code == 422
    assert "authoritative correctness requires trusted assessment" in (
        learner_correctness_rule.text
    )
    inconsistent_attempt_counts = client.post(
        "/api/learning-evidence/rules",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "course_id": scope["course_id"],
            "activities": [
                {
                    "activity_key": scope["unit_one"]["activity_key"],
                    "outcome": "completed",
                    "required_event_types": ["started", "attempted"],
                    "minimum_attempts": 1,
                    "minimum_correct_attempts": 2,
                }
            ],
        },
    )
    assert inconsistent_attempt_counts.status_code == 422
    assert "must not exceed minimum_attempts" in inconsistent_attempt_counts.text
    overlimit_attempt_count = client.post(
        "/api/learning-evidence/rules",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "course_id": scope["course_id"],
            "activities": [
                {
                    "activity_key": scope["unit_one"]["activity_key"],
                    "outcome": "completed",
                    "required_event_types": [],
                    "minimum_attempts": MAX_RULE_WITNESS_EVENTS + 1,
                }
            ],
        },
    )
    assert overlimit_attempt_count.status_code == 422
    assert str(MAX_RULE_WITNESS_EVENTS) in overlimit_attempt_count.text
    overlimit_witness = client.post(
        "/api/learning-evidence/rules",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "course_id": scope["course_id"],
            "activities": [
                {
                    "activity_key": scope["unit_one"]["activity_key"],
                    "outcome": "completed",
                    "required_event_types": ["started", "attempted"],
                    "minimum_attempts": MAX_RULE_WITNESS_EVENTS,
                }
            ],
        },
    )
    assert overlimit_witness.status_code == 422
    assert (
        f"at most {MAX_RULE_WITNESS_EVENTS} learner facts"
        in overlimit_witness.text
    )
    for activities in (
        [
            {
                "activity_key": scope["unit_two"]["activity_key"],
                "outcome": "transferred",
                "required_event_types": ["started"],
            }
        ],
        [
            {
                "activity_key": scope["unit_two"]["activity_key"],
                "outcome": "transferred",
                "required_event_types": ["attempted"],
                "minimum_attempts": 1,
            }
        ],
    ):
        degenerate_transfer = client.post(
            "/api/learning-evidence/rules",
            headers=_auth(scope["teacher"]["token"]),
            json={"course_id": scope["course_id"], "activities": activities},
        )
        assert degenerate_transfer.status_code == 422
        assert "transferred rules require an explained artifact" in degenerate_transfer.text

    rule = _create_rule(client, scope, assessment_editor["token"])
    assert rule["version_number"] == 1
    assert rule["status"] == "draft"
    assert rule["schema_version"] == 1
    _assert_explicit_utc(rule["created_at"])
    binding_typo = client.post(
        f"/api/learning-evidence/rules/{rule['id']}/activate",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "expected_revision": 0,
            "class_bindings": [
                {
                    "class_id": scope["class_id"],
                    "expected_plan_versoin": 1,
                }
            ],
        },
    )
    assert binding_typo.status_code == 422
    with get_session_factory(get_settings().database_url)() as db:
        persisted_draft = db.get(LearningCompletionRule, rule["id"])
        assert persisted_draft is not None
        assert persisted_draft.status == "draft"
        assert (
            db.scalar(
                select(text("count(*)")).select_from(LearningRuleActivation)
            )
            == 0
        )
        assert (
            db.scalar(
                select(text("count(*)")).select_from(LearningRuleClassBinding)
            )
            == 0
        )
    denied_activation = client.post(
        f"/api/learning-evidence/rules/{rule['id']}/activate",
        headers=_auth(assessment_editor["token"]),
        json={
            "expected_revision": 0,
            "class_bindings": [
                {"class_id": scope["class_id"], "expected_plan_version": 1}
            ],
        },
    )
    assert denied_activation.status_code == 403
    activated = _activate_rule(client, scope, rule)
    assert activated["revision"] == 1
    assert activated["changed"] is True
    assert activated["rule"]["status"] == "active"
    _assert_explicit_utc(activated["rule"]["activated_at"])
    assert activated["bindings"] == [
        {
            "class_id": scope["class_id"],
            "course_class_id": activated["bindings"][0]["course_class_id"],
            "plan_version": 1,
            "rule_id": rule["id"],
            "rule_version": 1,
        }
    ]
    stale = client.post(
        f"/api/learning-evidence/rules/{rule['id']}/activate",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "expected_revision": 0,
            "class_bindings": [
                {"class_id": scope["class_id"], "expected_plan_version": 1}
            ],
        },
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "activation_revision_conflict"
    student_denied = client.post(
        "/api/learning-evidence/rules",
        headers=_auth(scope["student"]["token"]),
        json=_rule_payload(scope),
    )
    assert student_denied.status_code == 403

    second = _create_rule(client, scope, assessment_editor["token"])
    assert second["version_number"] == 2
    rules = client.get(
        f"/api/learning-evidence/rules?course_id={scope['course_id']}",
        headers=_auth(assessment_editor["token"]),
    )
    assert rules.status_code == 200
    assert [item["version_number"] for item in rules.json()] == [1, 2]
    assert rules.json()[0]["definition_sha256"] == rule["definition_sha256"]
    with get_session_factory(get_settings().database_url)() as db:
        persisted = db.get(LearningCompletionRule, rule["id"])
        assert persisted.definition_json["activities"] == rule["activities"]
        assert persisted.definition_json["schema_version"] == 1
        binding = db.scalar(
            select(LearningRuleClassBinding).where(
                LearningRuleClassBinding.rule_id == rule["id"]
            )
        )
        assert binding is not None
        assert binding.plan_version == 1
        persisted.definition_json = {"activities": []}
        with pytest.raises(ValueError, match="definition is immutable"):
            db.commit()
        db.rollback()
    with get_session_factory(get_settings().database_url)() as db:
        persisted = db.get(LearningCompletionRule, rule["id"])
        assert persisted.definition_json["activities"] == rule["activities"]
        db.delete(persisted)
        with pytest.raises(ValueError, match="append-only"):
            db.commit()
        db.rollback()


def test_activation_state_is_authorized_and_reports_effective_class_pins(client):
    scope = _learning_scope(client, "activation-state")
    state_url = (
        f"/api/learning-evidence/rules/activation?course_id={scope['course_id']}"
    )
    initial = client.get(state_url, headers=_auth(scope["teacher"]["token"]))
    assert initial.status_code == 200, initial.json()
    assert initial.json()["revision"] == 0
    assert initial.json()["active_rule"] is None
    assert initial.json()["bindings"] == [
        {
            "class_id": scope["class_id"],
            "course_class_id": initial.json()["bindings"][0]["course_class_id"],
            "plan_version": 1,
            "binding_plan_version": None,
            "rule_id": None,
            "rule_version": None,
        }
    ]
    for denied_identity in (scope["student"], scope["outsider_teacher"]):
        denied = client.get(state_url, headers=_auth(denied_identity["token"]))
        assert denied.status_code == 403

    first_rule = _create_rule(client, scope)
    first_activation = _activate_rule(client, scope, first_rule)
    assert first_activation["revision"] == 1
    second_rule = _create_rule(client, scope)

    new_session_token = _login_again(client, scope["teacher"])
    current = client.get(state_url, headers=_auth(new_session_token))
    assert current.status_code == 200
    assert current.json()["revision"] == 1
    assert current.json()["active_rule"]["id"] == first_rule["id"]
    _assert_explicit_utc(current.json()["active_rule"]["activated_at"])

    switched_pointer = client.post(
        f"/api/learning-evidence/rules/{second_rule['id']}/activate",
        headers=_auth(new_session_token),
        json={"expected_revision": current.json()["revision"], "class_bindings": []},
    )
    assert switched_pointer.status_code == 200, switched_pointer.json()
    assert switched_pointer.json()["revision"] == 2
    pinned_old_rule = client.get(state_url, headers=_auth(new_session_token))
    assert pinned_old_rule.status_code == 200
    assert pinned_old_rule.json()["active_rule"]["id"] == second_rule["id"]
    assert pinned_old_rule.json()["bindings"][0]["rule_id"] == first_rule["id"]
    assert pinned_old_rule.json()["bindings"][0]["binding_plan_version"] == 1

    release_change = client.patch(
        f"/api/courses/{scope['course_id']}/classes/{scope['class_id']}/release-plan",
        headers=_auth(new_session_token),
        json={
            "expected_version": 1,
            "items": [
                {
                    "course_unit_id": scope["unit_two"]["id"],
                    "release_mode": "locked",
                }
            ],
        },
    )
    assert release_change.status_code == 200, release_change.json()
    inherited = client.get(state_url, headers=_auth(new_session_token))
    assert inherited.status_code == 200
    assert inherited.json()["bindings"] == [
        {
            "class_id": scope["class_id"],
            "course_class_id": inherited.json()["bindings"][0]["course_class_id"],
            "plan_version": 2,
            "binding_plan_version": 1,
            "rule_id": first_rule["id"],
            "rule_version": first_rule["version_number"],
        }
    ]

    rebound = client.post(
        f"/api/learning-evidence/rules/{second_rule['id']}/activate",
        headers=_auth(new_session_token),
        json={
            "expected_revision": inherited.json()["revision"],
            "class_bindings": [
                {"class_id": scope["class_id"], "expected_plan_version": 2}
            ],
        },
    )
    assert rebound.status_code == 200, rebound.json()
    assert rebound.json()["revision"] == 3
    final_state = client.get(state_url, headers=_auth(new_session_token))
    assert final_state.status_code == 200
    assert final_state.json()["bindings"] == [
        {
            "class_id": scope["class_id"],
            "course_class_id": final_state.json()["bindings"][0]["course_class_id"],
            "plan_version": 2,
            "binding_plan_version": 2,
            "rule_id": second_rule["id"],
            "rule_version": second_rule["version_number"],
        }
    ]

    other_scope = _learning_scope(client, "activation-state-other-course")
    cross_course = client.get(
        (
            "/api/learning-evidence/rules/activation"
            f"?course_id={other_scope['course_id']}"
        ),
        headers=_auth(new_session_token),
    )
    assert cross_course.status_code == 403


def test_rule_activities_must_belong_to_course_and_cover_published_units(client):
    scope = _learning_scope(client, "rule-coverage")
    unknown = client.post(
        "/api/learning-evidence/rules",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "course_id": scope["course_id"],
            "activities": [
                {
                    **_rule_payload(scope)["activities"][0],
                    "activity_key": "evidence.outside-course",
                }
            ],
        },
    )
    assert unknown.status_code == 422
    assert unknown.json()["detail"]["code"] == "activity_rule_unknown"
    with get_session_factory(get_settings().database_url)() as db:
        assert db.scalar(select(text("count(*)")).select_from(LearningCompletionRule)) == 0

    partial = client.post(
        "/api/learning-evidence/rules",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "course_id": scope["course_id"],
            "activities": [_rule_payload(scope)["activities"][0]],
        },
    )
    assert partial.status_code == 201, partial.json()
    rejected_activation = client.post(
        f"/api/learning-evidence/rules/{partial.json()['id']}/activate",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "expected_revision": 0,
            "class_bindings": [
                {"class_id": scope["class_id"], "expected_plan_version": 1}
            ],
        },
    )
    assert rejected_activation.status_code == 422
    assert (
        rejected_activation.json()["detail"]["code"]
        == "activity_rule_coverage_missing"
    )
    with get_session_factory(get_settings().database_url)() as db:
        persisted = db.get(LearningCompletionRule, partial.json()["id"])
        assert persisted is not None
        assert persisted.status == "draft"
        assert db.scalar(
            select(text("count(*)")).select_from(LearningRuleActivation)
        ) == 0
        assert db.scalar(
            select(text("count(*)")).select_from(LearningRuleClassBinding)
        ) == 0
        assert db.scalar(
            select(text("count(*)"))
            .select_from(AuditLog)
            .where(AuditLog.action == "learning_evidence.rule.activate")
        ) == 0

    draft_unit = client.post(
        f"/api/courses/{scope['course_id']}/units",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "title": "Future draft activity",
            "position": 3,
            "activity_key": "evidence.rule-coverage-future",
            "status": "draft",
        },
    )
    assert draft_unit.status_code == 201, draft_unit.json()
    future_rule = client.post(
        "/api/learning-evidence/rules",
        headers=_auth(scope["teacher"]["token"]),
        json={
            **_rule_payload(scope),
            "activities": [
                *_rule_payload(scope)["activities"],
                {
                    **_rule_payload(scope)["activities"][0],
                    "activity_key": draft_unit.json()["activity_key"],
                },
            ],
        },
    )
    assert future_rule.status_code == 201, future_rule.json()
    extra_scope_activation = client.post(
        f"/api/learning-evidence/rules/{future_rule.json()['id']}/activate",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "expected_revision": 0,
            "class_bindings": [
                {"class_id": scope["class_id"], "expected_plan_version": 1}
            ],
        },
    )
    assert extra_scope_activation.status_code == 422
    assert (
        extra_scope_activation.json()["detail"]["code"]
        == "activity_rule_scope_extra"
    )
    with get_session_factory(get_settings().database_url)() as db:
        persisted = db.get(
            LearningCompletionRule,
            future_rule.json()["id"],
        )
        assert persisted is not None
        assert persisted.status == "draft"
        assert (
            db.scalar(
                select(text("count(*)")).select_from(LearningRuleActivation)
            )
            == 0
        )
        assert (
            db.scalar(
                select(text("count(*)")).select_from(
                    LearningRuleClassBinding
                )
            )
            == 0
        )
        assert (
            db.scalar(
                select(text("count(*)"))
                .select_from(AuditLog)
                .where(
                    AuditLog.action == "learning_evidence.rule.activate"
                )
            )
            == 0
        )


def test_teacher_aggregate_excludes_course_units_outside_bound_rule(client):
    scope = _learning_scope(client, "aggregate-rule-scope")
    draft_unit = client.post(
        f"/api/courses/{scope['course_id']}/units",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "title": "Draft unit outside current completion rule",
            "position": 3,
            "activity_key": "evidence.aggregate-rule-scope-draft",
            "status": "draft",
        },
    )
    assert draft_unit.status_code == 201, draft_unit.json()
    rule = _create_rule(client, scope)
    _activate_rule(client, scope, rule)

    aggregate = client.get(
        (
            f"/api/learning-evidence/classes/{scope['class_id']}/courses/"
            f"{scope['course_id']}/aggregate"
        ),
        headers=_auth(scope["teacher"]["token"]),
    )
    assert aggregate.status_code == 200, aggregate.json()
    assert {
        activity["activity_key"] for activity in aggregate.json()["activities"]
    } == {
        scope["unit_one"]["activity_key"],
        scope["unit_two"]["activity_key"],
    }
    assert draft_unit.json()["activity_key"] not in {
        activity["activity_key"] for activity in aggregate.json()["activities"]
    }


def test_first_activation_compare_and_swap_is_deterministic_under_concurrency(client):
    scope = _learning_scope(client, "activation-concurrency")
    rule = _create_rule(client, scope)
    command = CompletionRuleActivate.model_validate(
        {
            "expected_revision": 0,
            "class_bindings": [
                {"class_id": scope["class_id"], "expected_plan_version": 1}
            ],
        }
    )
    barrier = Barrier(2)
    with get_session_factory(get_settings().database_url)() as db:
        detached_teacher = db.get(User, scope["teacher"]["id"])
        assert detached_teacher is not None
        db.expunge(detached_teacher)

    def activate_once():
        barrier.wait(timeout=5)
        with get_session_factory(get_settings().database_url)() as db:
            try:
                return (
                    "success",
                    activate_completion_rule(
                        db,
                        actor=detached_teacher,
                        rule_id=rule["id"],
                        payload=command,
                    ),
                )
            except LearningEvidenceError as exc:
                db.rollback()
                return ("error", (exc.status_code, exc.code))

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = [
            future.result(timeout=10)
            for future in [pool.submit(activate_once), pool.submit(activate_once)]
        ]
    successes = [value for outcome, value in outcomes if outcome == "success"]
    errors = [value for outcome, value in outcomes if outcome == "error"]
    assert len(successes) == 1
    assert successes[0]["changed"] is True
    assert successes[0]["revision"] == 1
    assert errors == [(409, "activation_revision_conflict")]
    with get_session_factory(get_settings().database_url)() as db:
        assert db.scalar(
            select(text("count(*)")).select_from(LearningRuleActivation)
        ) == 1
        assert db.scalar(
            select(text("count(*)")).select_from(LearningRuleClassBinding)
        ) == 1
        assert db.scalar(
            select(text("count(*)"))
            .select_from(AuditLog)
            .where(AuditLog.action == "learning_evidence.rule.activate")
        ) == 1


def test_activation_and_learner_write_share_lock_order_without_deadlock(client):
    scope = _learning_scope(client, "activation-vs-event")
    first_rule = _create_rule(client, scope)
    _activate_rule(client, scope, first_rule)
    release_change = client.patch(
        (
            f"/api/courses/{scope['course_id']}/classes/"
            f"{scope['class_id']}/release-plan"
        ),
        headers=_auth(scope["teacher"]["token"]),
        json={
            "expected_version": 1,
            "items": [
                {
                    "course_unit_id": scope["unit_two"]["id"],
                    "release_mode": "locked",
                }
            ],
        },
    )
    assert release_change.status_code == 200, release_change.json()
    second_rule = _create_rule(client, scope)
    activation_command = CompletionRuleActivate.model_validate(
        {
            "expected_revision": 1,
            "class_bindings": [
                {
                    "class_id": scope["class_id"],
                    "expected_plan_version": 2,
                }
            ],
        }
    )
    event_command = LearnerEvidenceEventCreate.model_validate(
        _event_payload(
            scope,
            client_event_id="activation-vs-event:started:0001",
            event_type="started",
            occurred_at=datetime.now(UTC),
            rule_version=first_rule["version_number"],
        )
    )
    with get_session_factory(get_settings().database_url)() as db:
        detached_teacher = db.get(User, scope["teacher"]["id"])
        detached_student = db.get(User, scope["student"]["id"])
        assert detached_teacher is not None
        assert detached_student is not None
        db.expunge(detached_teacher)
        db.expunge(detached_student)
    barrier = Barrier(2)

    def activate():
        barrier.wait(timeout=5)
        with get_session_factory(get_settings().database_url)() as db:
            return activate_completion_rule(
                db,
                actor=detached_teacher,
                rule_id=second_rule["id"],
                payload=activation_command,
            )

    def append():
        barrier.wait(timeout=5)
        with get_session_factory(get_settings().database_url)() as db:
            try:
                return (
                    "accepted",
                    append_learner_event(
                        db,
                        actor=detached_student,
                        payload=event_command,
                    ),
                )
            except LearningEvidenceError as exc:
                db.rollback()
                return ("rejected", (exc.status_code, exc.code))

    with ThreadPoolExecutor(max_workers=2) as pool:
        activation_future = pool.submit(activate)
        event_future = pool.submit(append)
        activated = activation_future.result(timeout=10)
        event_outcome = event_future.result(timeout=10)
    assert activated["revision"] == 2
    assert activated["rule"]["id"] == second_rule["id"]
    assert event_outcome[0] in {"accepted", "rejected"}
    if event_outcome[0] == "rejected":
        assert event_outcome[1] == (409, "rule_version_conflict")
    with get_session_factory(get_settings().database_url)() as db:
        binding = db.scalar(
            select(LearningRuleClassBinding).where(
                LearningRuleClassBinding.rule_id == second_rule["id"],
                LearningRuleClassBinding.plan_version == 2,
            )
        )
        assert binding is not None
        event_count = int(
            db.scalar(
                select(text("count(*)"))
                .select_from(LearningEvidenceEvent)
                .where(
                    LearningEvidenceEvent.client_event_id
                    == "activation-vs-event:started:0001"
                )
            )
            or 0
        )
        assert event_count == (1 if event_outcome[0] == "accepted" else 0)


def test_school_first_course_mutation_and_evidence_write_do_not_deadlock(client):
    scope = _learning_scope(client, "owner-vs-event")
    rule = _create_rule(client, scope)
    _activate_rule(client, scope, rule)
    command = LearnerEvidenceEventCreate.model_validate(
        _event_payload(
            scope,
            client_event_id="owner-vs-event:started:0001",
            event_type="started",
            occurred_at=datetime.now(UTC),
        )
    )
    with get_session_factory(get_settings().database_url)() as db:
        detached_student = db.get(User, scope["student"]["id"])
        assert detached_student is not None
        db.expunge(detached_student)
    barrier = Barrier(2)

    def owner_mutation():
        with get_session_factory(get_settings().database_url)() as db:
            barrier.wait(timeout=5)
            lock_active_school_for_write(db, scope["school_id"])
            course = db.scalar(
                select(Course)
                .where(Course.id == scope["course_id"])
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            assert course is not None
            course.title = f"{course.title} linearized"
            db.commit()
            return course.id

    def append():
        with get_session_factory(get_settings().database_url)() as db:
            barrier.wait(timeout=5)
            return append_learner_event(
                db,
                actor=detached_student,
                payload=command,
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        owner_future = pool.submit(owner_mutation)
        event_future = pool.submit(append)
        assert owner_future.result(timeout=10) == scope["course_id"]
        assert event_future.result(timeout=10)["outcome"] == "accepted"
    with get_session_factory(get_settings().database_url)() as db:
        course = db.get(Course, scope["course_id"])
        assert course is not None
        assert course.title.endswith(" linearized")
        assert db.scalar(
            select(LearningEvidenceEvent.id).where(
                LearningEvidenceEvent.client_event_id
                == "owner-vs-event:started:0001"
            )
        ) is not None


def test_out_of_order_idempotency_cross_device_projection_and_teacher_visibility(client):
    scope = _learning_scope(client, "order")
    rule = _create_rule(client, scope)
    _activate_rule(client, scope, rule)
    now = datetime.now(UTC)
    attempted_payload = _event_payload(
        scope,
        client_event_id="device-a:attempt:0001",
        event_type="attempted",
        occurred_at=now,
        evidence={
            "operation": "submit-answer",
            "reported_correct": True,
            "cursor": {"step": 2, "panel": "result"},
        },
    )
    attempted = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=attempted_payload,
    )
    assert attempted.status_code == 201, attempted.json()
    _assert_explicit_utc(attempted.json()["received_at"])
    assert set(attempted.json()) == {
        "event_id",
        "client_event_id",
        "event_type",
        "outcome",
        "received_at",
    }

    started_payload = _event_payload(
        scope,
        client_event_id="device-b:started:0001",
        event_type="started",
        occurred_at=now - timedelta(minutes=10),
        evidence={"cursor": {"step": 1}},
    )
    started = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=started_payload,
    )
    assert started.status_code == 201, started.json()
    second_device_token = _login_again(client, scope["student"])
    replay = client.post(
        "/api/learning-evidence/events",
        headers=_auth(second_device_token),
        json=attempted_payload,
    )
    assert replay.status_code == 200
    assert replay.json()["outcome"] == "duplicate"
    assert replay.json()["event_id"] == attempted.json()["event_id"]
    _assert_explicit_utc(replay.json()["received_at"])

    conflicting = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json={
            **attempted_payload,
            "evidence": {
                "operation": "submit-answer",
                "reported_correct": False,
                "cursor": {"step": 2},
            },
        },
    )
    assert conflicting.status_code == 409
    assert conflicting.json()["detail"]["code"] == "idempotency_payload_conflict"
    cross_subject = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["other_student"]["token"]),
        json=attempted_payload,
    )
    assert cross_subject.status_code == 403
    direct_completed = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json={
            **started_payload,
            "client_event_id": "device-a:forged-completed",
            "event_type": "completed",
        },
    )
    assert direct_completed.status_code == 422
    missing_operation = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json={
            **attempted_payload,
            "client_event_id": "device-a:missing-operation",
            "evidence": {"reported_correct": True},
        },
    )
    assert missing_operation.status_code == 422

    recovery = client.get(
        f"/api/learning-evidence/me/recovery?class_id={scope['class_id']}&course_id={scope['course_id']}",
        headers=_auth(second_device_token),
    )
    assert recovery.status_code == 200, recovery.json()
    foundation = next(
        item
        for item in recovery.json()["activities"]
        if item["course_unit_id"] == scope["unit_one"]["id"]
    )
    assert foundation["status"] == "completed"
    assert foundation["learner_event_count"] == 2
    assert foundation["attempt_count"] == 1
    assert foundation["reported_correct_attempt_count"] == 1
    assert foundation["resume_cursor"] == {"step": 2, "panel": "result"}
    assert recovery.json()["resume"]["last_event_id"] == attempted.json()["event_id"]
    assert recovery.json()["resume"]["cursor"] == {"step": 2, "panel": "result"}
    _assert_explicit_utc(foundation["first_started_at"])
    _assert_explicit_utc(foundation["last_occurred_at"])
    _assert_explicit_utc(foundation["completed_at"])
    _assert_explicit_utc(recovery.json()["resume"]["last_occurred_at"])

    aggregate = client.get(
        f"/api/learning-evidence/classes/{scope['class_id']}/courses/{scope['course_id']}/aggregate",
        headers=_auth(scope["teacher"]["token"]),
    )
    assert aggregate.status_code == 200, aggregate.json()
    aggregate_foundation = next(
        item
        for item in aggregate.json()["activities"]
        if item["course_unit_id"] == scope["unit_one"]["id"]
    )
    assert aggregate_foundation["completed"] == 1
    assert aggregate_foundation["completion_percent"] == 50.0
    _assert_explicit_utc(aggregate.json()["generated_at"])
    with get_session_factory(get_settings().database_url)() as db:
        events = list(
            db.scalars(
                select(LearningEvidenceEvent)
                .where(
                    LearningEvidenceEvent.subject_user_id == scope["student"]["id"],
                    LearningEvidenceEvent.course_unit_id == scope["unit_one"]["id"],
                )
                .order_by(LearningEvidenceEvent.id)
            ).all()
        )
        assert [event.event_type for event in events] == [
            "attempted",
            "started",
            "completed",
        ]
        assert events[-1].producer_type == "rule"
        assert events[-1].source_event_ids_json == [
            started.json()["event_id"],
            attempted.json()["event_id"],
        ]
    early_prediction = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=_event_payload(
            scope,
            client_event_id="device-b:predicted-before-start:0001",
            event_type="predicted",
            occurred_at=now - timedelta(minutes=20),
            evidence={"prediction": "initial-hypothesis"},
        ),
    )
    assert early_prediction.status_code == 201
    reordered = client.get(
        f"/api/learning-evidence/me/recovery?class_id={scope['class_id']}&course_id={scope['course_id']}",
        headers=_auth(second_device_token),
    )
    reordered_foundation = next(
        item
        for item in reordered.json()["activities"]
        if item["course_unit_id"] == scope["unit_one"]["id"]
    )
    first_started_at = datetime.fromisoformat(
        reordered_foundation["first_started_at"].replace("Z", "+00:00")
    )
    if first_started_at.tzinfo is None:
        first_started_at = first_started_at.replace(tzinfo=UTC)
    assert first_started_at == now - timedelta(minutes=10)


def test_learner_fact_payloads_are_strong_typed_strict_json_and_case_sensitive(client):
    scope = _learning_scope(client, "fact-contract")
    rule = _create_rule(client, scope)
    _activate_rule(client, scope, rule)
    now = datetime.now(UTC)
    invalid_payloads = [
        _event_payload(
            scope,
            client_event_id="facts:invalid:predicted:0001",
            event_type="predicted",
            occurred_at=now,
        ),
        _event_payload(
            scope,
            client_event_id="facts:invalid:attempted:0001",
            event_type="attempted",
            occurred_at=now,
            evidence={"operation": "submit", "correct": True},
        ),
        _event_payload(
            scope,
            client_event_id="facts:invalid:corrected:0001",
            event_type="corrected",
            occurred_at=now,
        ),
        _event_payload(
            scope,
            client_event_id="facts:invalid:explained:0001",
            event_type="explained",
            occurred_at=now,
            unit="unit_two",
        ),
        {
            **_event_payload(
                scope,
                client_event_id="facts:invalid:schema-version:0001",
                event_type="started",
                occurred_at=now,
            ),
            "event_schema_version": 99,
        },
        _event_payload(
            scope,
            client_event_id="facts:invalid:started-field:0001",
            event_type="started",
            occurred_at=now,
            evidence={"operation": "not-valid-for-started"},
        ),
        _event_payload(
            scope,
            client_event_id="@rule:reserved-client-key:0001",
            event_type="started",
            occurred_at=now,
        ),
    ]
    for payload in invalid_payloads:
        rejected = client.post(
            "/api/learning-evidence/events",
            headers=_auth(scope["student"]["token"]),
            json=payload,
        )
        assert rejected.status_code == 422

    nan_payload = _event_payload(
        scope,
        client_event_id="facts:invalid:nan:0001",
        event_type="attempted",
        occurred_at=now,
        evidence={"operation": "submit", "reported_correct": float("nan")},
    )
    rejected_nan = client.post(
        "/api/learning-evidence/events",
        headers={
            **_auth(scope["student"]["token"]),
            "Content-Type": "application/json",
        },
        content=json.dumps(nan_payload),
    )
    assert rejected_nan.status_code == 422

    valid_payloads = [
        _event_payload(
            scope,
            client_event_id="facts:valid:predicted:0001",
            event_type="predicted",
            occurred_at=now,
            evidence={"prediction": {"state": "stable"}},
        ),
        _event_payload(
            scope,
            client_event_id="facts:valid:attempted:0001",
            event_type="attempted",
            occurred_at=now + timedelta(seconds=1),
            evidence={"operation": "submit", "reported_correct": True},
        ),
        _event_payload(
            scope,
            client_event_id="facts:valid:corrected:0001",
            event_type="corrected",
            occurred_at=now + timedelta(seconds=2),
            evidence={"correction": "Revised the model boundary."},
        ),
        _event_payload(
            scope,
            client_event_id="facts:valid:explained:0001",
            event_type="explained",
            occurred_at=now + timedelta(seconds=3),
            unit="unit_two",
            evidence={"artifact": {"kind": "explanation", "ref": "note-1"}},
        ),
    ]
    for payload in valid_payloads:
        accepted = client.post(
            "/api/learning-evidence/events",
            headers=_auth(scope["student"]["token"]),
            json=payload,
        )
        assert accepted.status_code == 201, accepted.json()

    for client_event_id in ("Device-Case-Key:0001", "device-case-key:0001"):
        accepted = client.post(
            "/api/learning-evidence/events",
            headers=_auth(scope["student"]["token"]),
            json=_event_payload(
                scope,
                client_event_id=client_event_id,
                event_type="started",
                occurred_at=now + timedelta(seconds=4),
            ),
        )
        assert accepted.status_code == 201, accepted.json()

    with get_session_factory(get_settings().database_url)() as db:
        invalid_count = db.scalar(
            select(text("count(*)"))
            .select_from(LearningEvidenceEvent)
            .where(LearningEvidenceEvent.client_event_id.like("facts:invalid:%"))
        )
        assert invalid_count == 0
        assert (
            db.scalar(
                select(text("count(*)"))
                .select_from(LearningEvidenceEvent)
                .where(
                    LearningEvidenceEvent.client_event_id
                    == "@rule:reserved-client-key:0001"
                )
            )
            == 0
        )
        case_rows = list(
            db.scalars(
                select(LearningEvidenceEvent).where(
                    LearningEvidenceEvent.client_event_id.in_(
                        ["Device-Case-Key:0001", "device-case-key:0001"]
                    )
                )
            ).all()
        )
        assert len(case_rows) == 2
        assert {event.client_event_id for event in case_rows} == {
            "Device-Case-Key:0001",
            "device-case-key:0001",
        }
        relevant_events = list(
            db.scalars(
                select(LearningEvidenceEvent).where(
                    LearningEvidenceEvent.subject_user_id == scope["student"]["id"]
                )
            ).all()
        )
        assert relevant_events
        assert {
            event.event_schema_version for event in relevant_events
        } == {CURRENT_EVENT_SCHEMA_VERSION}


def test_learner_reported_correct_does_not_satisfy_authoritative_result(client):
    scope = _learning_scope(client, "reported-correct")
    created_rule = client.post(
        "/api/learning-evidence/rules",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "course_id": scope["course_id"],
            "activities": [
                {
                    "activity_key": scope["unit_one"]["activity_key"],
                    "outcome": "completed",
                    "required_event_types": [],
                    "minimum_attempts": 2,
                },
                {
                    "activity_key": scope["unit_two"]["activity_key"],
                    "outcome": "transferred",
                    "required_event_types": ["explained"],
                },
            ],
        },
    )
    assert created_rule.status_code == 201, created_rule.json()
    _activate_rule(client, scope, created_rule.json())
    now = datetime.now(UTC)
    claimed_correct = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=_event_payload(
            scope,
            client_event_id="reported-correct:first-attempt:0001",
            event_type="attempted",
            occurred_at=now,
            evidence={"operation": "submit", "reported_correct": True},
        ),
    )
    assert claimed_correct.status_code == 201
    claimed_transfer = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=_event_payload(
            scope,
            client_event_id="reported-correct:transfer-attempt:0001",
            event_type="attempted",
            occurred_at=now,
            unit="unit_two",
            evidence={"operation": "submit", "reported_correct": True},
        ),
    )
    assert claimed_transfer.status_code == 201
    recovery = client.get(
        f"/api/learning-evidence/me/recovery?class_id={scope['class_id']}&course_id={scope['course_id']}",
        headers=_auth(scope["student"]["token"]),
    )
    assert recovery.status_code == 200
    by_unit = {
        item["course_unit_id"]: item for item in recovery.json()["activities"]
    }
    assert by_unit[scope["unit_one"]["id"]]["status"] == "in_progress"
    assert by_unit[scope["unit_two"]["id"]]["status"] == "in_progress"
    assert by_unit[scope["unit_one"]["id"]]["reported_correct_attempt_count"] == 1

    second_attempt = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=_event_payload(
            scope,
            client_event_id="reported-correct:second-attempt:0001",
            event_type="attempted",
            occurred_at=now + timedelta(seconds=1),
            evidence={"operation": "retry", "reported_correct": False},
        ),
    )
    assert second_attempt.status_code == 201
    completed = client.get(
        f"/api/learning-evidence/me/recovery?class_id={scope['class_id']}&course_id={scope['course_id']}",
        headers=_auth(scope["student"]["token"]),
    )
    completed_unit = next(
        item
        for item in completed.json()["activities"]
        if item["course_unit_id"] == scope["unit_one"]["id"]
    )
    assert completed_unit["status"] == "completed"
    assert completed_unit["reported_correct_attempt_count"] == 1


def test_reserved_rule_event_key_collision_fails_closed(client):
    scope = _learning_scope(client, "reserved-rule-key")
    rule = _create_rule(client, scope)
    _activate_rule(client, scope, rule)
    now = datetime.now(UTC)
    with get_session_factory(get_settings().database_url)() as db:
        common = {
            "actor_user_id": scope["student"]["id"],
            "subject_user_id": scope["student"]["id"],
            "producer_type": "learner",
            "school_id": scope["school_id"],
            "class_id": scope["class_id"],
            "course_id": scope["course_id"],
            "course_unit_id": scope["unit_one"]["id"],
            "assignment_id": None,
            "activity_key": scope["unit_one"]["activity_key"],
            "rule_id": rule["id"],
            "rule_version": rule["version_number"],
            "event_schema_version": CURRENT_EVENT_SCHEMA_VERSION,
            "source_event_ids_json": [],
            "corrects_event_id": None,
            "received_at": now,
        }
        started = LearningEvidenceEvent(
            **common,
            client_event_id="reserved-key:source-started:0001",
            request_sha256="1" * 64,
            event_type="started",
            evidence_json={},
            occurred_at=now,
        )
        db.add(started)
        db.flush([started])
        attempted = LearningEvidenceEvent(
            **common,
            client_event_id="reserved-key:source-attempted:0001",
            request_sha256="2" * 64,
            event_type="attempted",
            evidence_json={"operation": "submit-observation"},
            occurred_at=now + timedelta(microseconds=1),
        )
        db.add(attempted)
        db.flush([attempted])
        source_event_ids = (started.id, attempted.id)
        source_token = ",".join(str(event_id) for event_id in source_event_ids)
        reserved_key = (
            f"{RULE_DERIVED_CLIENT_EVENT_PREFIX}{rule['id']}:"
            f"{scope['student']['id']}:{scope['unit_one']['id']}:completed:"
            f"{hashlib.sha256(source_token.encode('utf-8')).hexdigest()[:32]}"
        )
        collision = LearningEvidenceEvent(
            **common,
            client_event_id=reserved_key,
            request_sha256="3" * 64,
            event_type="predicted",
            evidence_json={"prediction": "malicious reserved-key collision"},
            occurred_at=now + timedelta(microseconds=2),
        )
        db.add(collision)
        db.commit()
        attempted_id = attempted.id

    with get_session_factory(get_settings().database_url)() as db:
        source_event = db.get(LearningEvidenceEvent, attempted_id)
        assert source_event is not None
        with pytest.raises(LearningEvidenceError) as rejected:
            learning_evidence_service._append_rule_derived_event(
                db,
                actor_user_id=scope["student"]["id"],
                source_event=source_event,
                outcome="completed",
                source_event_ids=source_event_ids,
                locking_read=True,
            )
        assert rejected.value.status_code == 409
        assert rejected.value.code == "derived_event_key_collision"
        db.rollback()

    with get_session_factory(get_settings().database_url)() as db:
        source_event = db.get(LearningEvidenceEvent, attempted_id)
        persisted_rule = db.get(LearningCompletionRule, rule["id"])
        assert source_event is not None
        assert persisted_rule is not None
        projection = learning_evidence_projection.rebuild_activity_projection(
            db,
            scope=learning_evidence_projection.scope_from_event(source_event),
            definition_json=persisted_rule.definition_json,
            locking_read=True,
        )
        db.commit()
        assert projection.status == "in_progress"
        assert (
            db.scalar(
                select(text("count(*)"))
                .select_from(LearningEvidenceEvent)
                .where(
                    LearningEvidenceEvent.client_event_id == reserved_key,
                    LearningEvidenceEvent.producer_type == "rule",
                )
            )
            == 0
        )


def test_occurred_at_range_is_shared_by_all_evidence_writers(client):
    scope = _learning_scope(client, "occurred-range")
    rule = _create_rule(client, scope)
    _activate_rule(client, scope, rule)
    invalid_timestamps = (
        "0001-01-01T00:00:00Z",
        "0001-01-01T00:00:00+14:00",
        "9999-12-31T23:59:59-12:00",
    )
    for index, occurred_at in enumerate(invalid_timestamps):
        payload = _event_payload(
            scope,
            client_event_id=f"occurred-range:learner:{index:04d}",
            event_type="started",
            occurred_at=datetime.now(UTC),
        )
        payload["occurred_at"] = occurred_at
        response = client.post(
            "/api/learning-evidence/events",
            headers=_auth(scope["student"]["token"]),
            json=payload,
        )
        assert response.status_code == 422, response.text
        response.content.decode("utf-8")
    with get_session_factory(get_settings().database_url)() as db:
        teacher = db.get(User, scope["teacher"]["id"])
        assert teacher is not None
        for index, occurred_at in enumerate(invalid_timestamps):
            with pytest.raises(LearningEvidenceError) as invalid:
                append_trusted_assessment_result(
                    db,
                    actor=teacher,
                    subject_user_id=scope["student"]["id"],
                    client_event_id=f"occurred-range:trusted:{index:04d}",
                    class_id=scope["class_id"],
                    course_id=scope["course_id"],
                    course_unit_id=scope["unit_one"]["id"],
                    activity_key=scope["unit_one"]["activity_key"],
                    rule_version=rule["version_number"],
                    outcome="completed",
                    source_ref=f"range-check:{index}",
                    occurred_at=datetime.fromisoformat(
                        occurred_at.replace("Z", "+00:00")
                    ),
                    evidence={},
                )
            assert invalid.value.status_code == 422
            assert invalid.value.code == "trusted_evidence_invalid"
            db.rollback()
    valid_target = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=_event_payload(
            scope,
            client_event_id="occurred-range:target:0001",
            event_type="attempted",
            occurred_at=datetime.now(UTC),
            evidence={"operation": "create-correction-target"},
        ),
    )
    assert valid_target.status_code == 201, valid_target.json()
    with get_session_factory(get_settings().database_url)() as db:
        baseline_events = int(
            db.scalar(
                select(text("count(*)")).select_from(LearningEvidenceEvent)
            )
            or 0
        )
    for index, occurred_at in enumerate(invalid_timestamps):
        response = client.post(
            (
                f"/api/learning-evidence/events/"
                f"{valid_target.json()['event_id']}/corrections"
            ),
            headers=_auth(scope["teacher"]["token"]),
            json={
                "client_event_id": f"occurred-range:correction:{index:04d}",
                "reason": "Invalid timestamp must not reach the ledger.",
                "occurred_at": occurred_at,
            },
        )
        assert response.status_code == 422, response.text
        response.content.decode("utf-8")
    with get_session_factory(get_settings().database_url)() as db:
        assert (
            int(
                db.scalar(
                    select(text("count(*)")).select_from(
                        LearningEvidenceEvent
                    )
                )
                or 0
            )
            == baseline_events
        )
        assert (
            db.scalar(
                select(text("count(*)"))
                .select_from(AuditLog)
                .where(
                    AuditLog.action == "learning_evidence.event.correct"
                )
            )
            == 0
        )
        assert (
            db.scalar(
                select(text("count(*)"))
                .select_from(LearningEvidenceEvent)
                .where(
                    LearningEvidenceEvent.client_event_id.like(
                        "occurred-range:trusted:%"
                    )
                )
            )
            == 0
        )


def test_invalid_unicode_is_422_and_chinese_replay_hashes_are_stable(client):
    scope = _learning_scope(client, "unicode-boundary")
    rule = _create_rule(client, scope)
    _activate_rule(client, scope, rule)
    now = datetime.now(UTC)

    def post_raw_json(path: str, token: str, payload: dict):
        return client.post(
            path,
            headers={
                **_auth(token),
                "Content-Type": "application/json",
            },
            content=json.dumps(payload, ensure_ascii=True),
        )

    nested_surrogate = _event_payload(
        scope,
        client_event_id="unicode:learner:nested:0001",
        event_type="explained",
        occurred_at=now,
        evidence={"artifact": {"nested": "\ud800"}},
    )
    invalid_nested = post_raw_json(
        "/api/learning-evidence/events",
        scope["student"]["token"],
        nested_surrogate,
    )
    assert invalid_nested.status_code == 422, invalid_nested.text
    invalid_nested.content.decode("utf-8")
    surrogate_key = _event_payload(
        scope,
        client_event_id="unicode:learner:key:0001",
        event_type="started",
        occurred_at=now,
        evidence={"\ud800": "invalid-key"},
    )
    invalid_key = post_raw_json(
        "/api/learning-evidence/events",
        scope["student"]["token"],
        surrogate_key,
    )
    assert invalid_key.status_code == 422, invalid_key.text
    invalid_key.content.decode("utf-8")

    rule_with_surrogate_extra = _rule_payload(scope)
    rule_with_surrogate_extra["\ud800"] = "invalid-extra-key"
    invalid_rule_key = post_raw_json(
        "/api/learning-evidence/rules",
        scope["teacher"]["token"],
        rule_with_surrogate_extra,
    )
    assert invalid_rule_key.status_code == 422, invalid_rule_key.text
    invalid_rule_key.content.decode("utf-8")
    rule_with_surrogate_value = _rule_payload(scope)
    rule_with_surrogate_value["activities"][0]["required_event_types"] = [
        "\ud800"
    ]
    invalid_rule_value = post_raw_json(
        "/api/learning-evidence/rules",
        scope["teacher"]["token"],
        rule_with_surrogate_value,
    )
    assert invalid_rule_value.status_code == 422, invalid_rule_value.text
    invalid_rule_value.content.decode("utf-8")

    with get_session_factory(get_settings().database_url)() as db:
        teacher = db.get(User, scope["teacher"]["id"])
        assert teacher is not None
        for index, (source_ref, evidence) in enumerate(
            (
                ("\ud800", {}),
                ("trusted-unicode-source", {"\ud800": "invalid-key"}),
                (
                    "trusted-unicode-value",
                    {"artifact": {"nested": "\ud800"}},
                ),
            )
        ):
            with pytest.raises(LearningEvidenceError) as invalid:
                append_trusted_assessment_result(
                    db,
                    actor=teacher,
                    subject_user_id=scope["student"]["id"],
                    client_event_id=f"unicode:trusted:{index:04d}",
                    class_id=scope["class_id"],
                    course_id=scope["course_id"],
                    course_unit_id=scope["unit_one"]["id"],
                    activity_key=scope["unit_one"]["activity_key"],
                    rule_version=rule["version_number"],
                    outcome="completed",
                    source_ref=source_ref,
                    occurred_at=now,
                    evidence=evidence,
                )
            assert invalid.value.status_code == 422
            assert invalid.value.code == "trusted_evidence_invalid"
            db.rollback()

    chinese_payload = _event_payload(
        scope,
        client_event_id="unicode:chinese-prediction:0001",
        event_type="predicted",
        occurred_at=now,
        evidence={"prediction": "中文预测证据"},
    )
    chinese_event = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=chinese_payload,
    )
    assert chinese_event.status_code == 201, chinese_event.json()
    chinese_replay = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=chinese_payload,
    )
    assert chinese_replay.status_code == 200, chinese_replay.json()
    assert chinese_replay.json()["event_id"] == chinese_event.json()["event_id"]
    invalid_reason = post_raw_json(
        (
            f"/api/learning-evidence/events/"
            f"{chinese_event.json()['event_id']}/corrections"
        ),
        scope["teacher"]["token"],
        {
            "client_event_id": "unicode:correction:invalid",
            "reason": "\ud800",
            "occurred_at": (now + timedelta(seconds=1)).isoformat(),
        },
    )
    assert invalid_reason.status_code == 422, invalid_reason.text
    invalid_reason.content.decode("utf-8")
    correction_payload = {
        "client_event_id": "unicode:correction:chinese",
        "reason": "教师中文纠错理由",
        "occurred_at": (now + timedelta(seconds=2)).isoformat(),
    }
    chinese_correction = client.post(
        (
            f"/api/learning-evidence/events/"
            f"{chinese_event.json()['event_id']}/corrections"
        ),
        headers=_auth(scope["teacher"]["token"]),
        json=correction_payload,
    )
    assert chinese_correction.status_code == 201, chinese_correction.json()
    correction_replay = client.post(
        (
            f"/api/learning-evidence/events/"
            f"{chinese_event.json()['event_id']}/corrections"
        ),
        headers=_auth(scope["teacher"]["token"]),
        json=correction_payload,
    )
    assert correction_replay.status_code == 200, correction_replay.json()
    assert (
        correction_replay.json()["event_id"]
        == chinese_correction.json()["event_id"]
    )
    with get_session_factory(get_settings().database_url)() as db:
        assert (
            db.scalar(
                select(text("count(*)"))
                .select_from(LearningEvidenceEvent)
                .where(
                    LearningEvidenceEvent.client_event_id.in_(
                        (
                            "unicode:learner:nested:0001",
                            "unicode:learner:key:0001",
                            "unicode:correction:invalid",
                        )
                    )
                )
            )
            == 0
        )
        assert (
            db.scalar(
                select(text("count(*)"))
                .select_from(LearningEvidenceEvent)
                .where(
                    LearningEvidenceEvent.client_event_id.like(
                        "unicode:trusted:%"
                    )
                )
            )
            == 0
        )
        assert (
            db.scalar(
                select(text("count(*)"))
                .select_from(LearningCompletionRule)
            )
            == 1
        )
        assert (
            db.scalar(
                select(text("count(*)"))
                .select_from(AuditLog)
                .where(
                    AuditLog.action == "learning_evidence.event.correct"
                )
            )
            == 1
        )


def test_transferred_is_rule_or_trusted_assessment_only(client):
    scope = _learning_scope(client, "transfer")
    rule = _create_rule(client, scope)
    _activate_rule(client, scope, rule)
    explained = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=_event_payload(
            scope,
            client_event_id="transfer:learner-explained:0001",
            event_type="explained",
            occurred_at=datetime.now(UTC),
            unit="unit_two",
            evidence={"artifact": "different-context-explanation"},
        ),
    )
    assert explained.status_code == 201, explained.json()
    recovery = client.get(
        f"/api/learning-evidence/me/recovery?class_id={scope['class_id']}&course_id={scope['course_id']}",
        headers=_auth(scope["student"]["token"]),
    )
    assert recovery.status_code == 200
    transfer = next(
        item
        for item in recovery.json()["activities"]
        if item["course_unit_id"] == scope["unit_two"]["id"]
    )
    assert transfer["status"] == "transferred"
    with get_session_factory(get_settings().database_url)() as db:
        transferred = db.scalar(
            select(LearningEvidenceEvent).where(
                LearningEvidenceEvent.subject_user_id == scope["student"]["id"],
                LearningEvidenceEvent.event_type == "transferred",
            )
        )
        assert transferred is not None
        assert transferred.producer_type == "rule"

    trusted_subject = scope["other_student"]
    trusted_occurred_at = datetime.now(UTC)
    with get_session_factory(get_settings().database_url)() as db:
        teacher = db.get(User, scope["teacher"]["id"])
        assert teacher is not None
        count_before_mismatch = int(
            db.scalar(select(text("count(*)")).select_from(LearningEvidenceEvent))
            or 0
        )
        for index, (unit_name, mismatched_outcome) in enumerate(
            (
                ("unit_one", "transferred"),
                ("unit_two", "completed"),
            ),
            start=1,
        ):
            unit = scope[unit_name]
            with pytest.raises(LearningEvidenceError) as mismatch:
                append_trusted_assessment_result(
                    db,
                    actor=teacher,
                    subject_user_id=trusted_subject["id"],
                    client_event_id=f"trusted:outcome-mismatch:{index:04d}",
                    class_id=scope["class_id"],
                    course_id=scope["course_id"],
                    course_unit_id=unit["id"],
                    activity_key=unit["activity_key"],
                    rule_version=1,
                    outcome=mismatched_outcome,
                    source_ref=f"judge-result:mismatch-{index}",
                    occurred_at=trusted_occurred_at,
                    evidence={"rubric": "must-match-bound-rule"},
                )
            assert mismatch.value.status_code == 422
            assert mismatch.value.code == "trusted_outcome_mismatch"
            db.rollback()
        assert (
            int(
                db.scalar(
                    select(text("count(*)")).select_from(LearningEvidenceEvent)
                )
                or 0
            )
            == count_before_mismatch
        )
    with get_session_factory(get_settings().database_url)() as db:
        teacher = db.get(User, scope["teacher"]["id"])
        assert teacher is not None
        receipt = append_trusted_assessment_result(
            db,
            actor=teacher,
            subject_user_id=trusted_subject["id"],
            client_event_id="trusted:transfer:assessment:0001",
            class_id=scope["class_id"],
            course_id=scope["course_id"],
            course_unit_id=scope["unit_two"]["id"],
            activity_key=scope["unit_two"]["activity_key"],
            rule_version=1,
            outcome="transferred",
            source_ref="judge-result:trusted-42",
            occurred_at=trusted_occurred_at,
            evidence={"rubric": "cross-context-v1"},
        )
        assert receipt["outcome"] == "accepted"
        replay = append_trusted_assessment_result(
            db,
            actor=teacher,
            subject_user_id=trusted_subject["id"],
            client_event_id="trusted:transfer:assessment:0001",
            class_id=scope["class_id"],
            course_id=scope["course_id"],
            course_unit_id=scope["unit_two"]["id"],
            activity_key=scope["unit_two"]["activity_key"],
            rule_version=1,
            outcome="transferred",
            source_ref="judge-result:trusted-42",
            occurred_at=trusted_occurred_at,
            evidence={"rubric": "cross-context-v1"},
        )
        assert replay["outcome"] == "duplicate"
        with pytest.raises(LearningEvidenceError) as conflict:
            append_trusted_assessment_result(
                db,
                actor=teacher,
                subject_user_id=trusted_subject["id"],
                client_event_id="trusted:transfer:assessment:0001",
                class_id=scope["class_id"],
                course_id=scope["course_id"],
                course_unit_id=scope["unit_two"]["id"],
                activity_key=scope["unit_two"]["activity_key"],
                rule_version=1,
                outcome="transferred",
                source_ref="judge-result:different",
                occurred_at=trusted_occurred_at,
                evidence={"rubric": "cross-context-v1"},
            )
        assert conflict.value.status_code == 409
        assert conflict.value.code == "idempotency_payload_conflict"
        stored_trusted = db.scalar(
            select(LearningEvidenceEvent).where(
                LearningEvidenceEvent.client_event_id
                == "trusted:transfer:assessment:0001"
            )
        )
        assert stored_trusted is not None
        assert stored_trusted.evidence_json["source_ref"] == "judge-result:trusted-42"
        assert stored_trusted.event_schema_version == CURRENT_EVENT_SCHEMA_VERSION
    trusted_recovery = client.get(
        f"/api/learning-evidence/me/recovery?class_id={scope['class_id']}&course_id={scope['course_id']}",
        headers=_auth(trusted_subject["token"]),
    )
    assert trusted_recovery.status_code == 200
    trusted_transfer = next(
        item
        for item in trusted_recovery.json()["activities"]
        if item["course_unit_id"] == scope["unit_two"]["id"]
    )
    assert trusted_transfer["status"] == "transferred"

    concurrent_occurred_at = datetime.now(UTC)
    concurrent_barrier = Barrier(2)
    with get_session_factory(get_settings().database_url)() as db:
        detached_teacher = db.get(User, scope["teacher"]["id"])
        assert detached_teacher is not None
        db.expunge(detached_teacher)

    def append_trusted_once():
        concurrent_barrier.wait(timeout=5)
        with get_session_factory(get_settings().database_url)() as db:
            return append_trusted_assessment_result(
                db,
                actor=detached_teacher,
                subject_user_id=trusted_subject["id"],
                client_event_id="trusted:concurrent:assessment:0001",
                class_id=scope["class_id"],
                course_id=scope["course_id"],
                course_unit_id=scope["unit_one"]["id"],
                activity_key=scope["unit_one"]["activity_key"],
                rule_version=1,
                outcome="completed",
                source_ref="judge-result:concurrent-42",
                occurred_at=concurrent_occurred_at,
                evidence={"rubric": "trusted-completion-v1"},
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        concurrent_receipts = [
            future.result(timeout=10)
            for future in [pool.submit(append_trusted_once), pool.submit(append_trusted_once)]
        ]
    assert sorted(receipt["outcome"] for receipt in concurrent_receipts) == [
        "accepted",
        "duplicate",
    ]
    assert len({receipt["event_id"] for receipt in concurrent_receipts}) == 1
    with get_session_factory(get_settings().database_url)() as db:
        assert (
            db.scalar(
                select(text("count(*)"))
                .select_from(LearningEvidenceEvent)
                .where(
                    LearningEvidenceEvent.client_event_id
                    == "trusted:concurrent:assessment:0001"
                )
            )
            == 1
        )


def test_trusted_assessment_payload_is_bounded_strict_and_source_ref_reserved(client):
    scope = _learning_scope(client, "trusted-boundary")
    rule = _create_rule(client, scope)
    _activate_rule(client, scope, rule)
    now = datetime.now(UTC)
    invalid_cases = [
        ("trusted:invalid:blank-source", "   ", {"rubric": "v1"}),
        ("trusted:invalid:long-source", "x" * 257, {"rubric": "v1"}),
        (
            "trusted:invalid:oversized",
            "judge:oversized",
            {"blob": "x" * MAX_EVIDENCE_BYTES},
        ),
        ("trusted:invalid:not-json", "judge:not-json", {"value": object()}),
        (
            "trusted:invalid:spoof-source",
            "judge:authoritative",
            {"source_ref": "judge:spoofed"},
        ),
        (
            "trusted:invalid:infinity",
            "judge:infinity",
            {"score": float("inf")},
        ),
    ]
    with get_session_factory(get_settings().database_url)() as db:
        teacher = db.get(User, scope["teacher"]["id"])
        assert teacher is not None
        for client_event_id, source_ref, evidence in invalid_cases:
            with pytest.raises(LearningEvidenceError) as invalid:
                append_trusted_assessment_result(
                    db,
                    actor=teacher,
                    subject_user_id=scope["other_student"]["id"],
                    client_event_id=client_event_id,
                    class_id=scope["class_id"],
                    course_id=scope["course_id"],
                    course_unit_id=scope["unit_two"]["id"],
                    activity_key=scope["unit_two"]["activity_key"],
                    rule_version=rule["version_number"],
                    outcome="transferred",
                    source_ref=source_ref,
                    occurred_at=now,
                    evidence=evidence,
                )
            assert invalid.value.status_code == 422
            assert invalid.value.code == "trusted_evidence_invalid"
        assert (
            db.scalar(
                select(text("count(*)"))
                .select_from(LearningEvidenceEvent)
                .where(LearningEvidenceEvent.client_event_id.like("trusted:invalid:%"))
            )
            == 0
        )


def test_release_plan_patch_wins_before_waiting_learner_event_anchor(
    client,
    monkeypatch,
):
    scope = _learning_scope(client, "release-event-race")
    rule = _create_rule(client, scope)
    _activate_rule(client, scope, rule)
    event_waiting = Event()
    release_committed = Event()
    original_anchor = learning_evidence_service._lock_course_evidence_anchor

    def pause_before_course_anchor(db, course_id):
        event_waiting.set()
        assert release_committed.wait(timeout=5)
        return original_anchor(db, course_id)

    monkeypatch.setattr(
        learning_evidence_service,
        "_lock_course_evidence_anchor",
        pause_before_course_anchor,
    )
    payload = _event_payload(
        scope,
        client_event_id="release-event-race:started:0001",
        event_type="started",
        occurred_at=datetime.now(UTC),
    )

    with ThreadPoolExecutor(max_workers=1) as pool:
        event_future = pool.submit(
            client.post,
            "/api/learning-evidence/events",
            headers=_auth(scope["student"]["token"]),
            json=payload,
        )
        assert event_waiting.wait(timeout=5)
        release = client.patch(
            f"/api/courses/{scope['course_id']}/classes/{scope['class_id']}/release-plan",
            headers=_auth(scope["teacher"]["token"]),
            json={
                "expected_version": 1,
                "items": [
                    {
                        "course_unit_id": scope["unit_one"]["id"],
                        "release_mode": "hidden",
                    }
                ],
            },
        )
        assert release.status_code == 200, release.json()
        release_committed.set()
        event_response = event_future.result(timeout=10)

    assert event_response.status_code == 403, event_response.json()
    with get_session_factory(get_settings().database_url)() as db:
        assert (
            db.scalar(
                select(text("count(*)"))
                .select_from(LearningEvidenceEvent)
                .where(
                    LearningEvidenceEvent.client_event_id
                    == payload["client_event_id"]
                )
            )
            == 0
        )


def test_hidden_locked_archived_rejection_and_minimal_old_replay(client):
    scope = _learning_scope(client, "release")
    rule = _create_rule(client, scope)
    activation = _activate_rule(client, scope, rule)
    payload = _event_payload(
        scope,
        client_event_id="release:started:0001",
        event_type="started",
        occurred_at=datetime.now(UTC),
    )
    created = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=payload,
    )
    assert created.status_code == 201
    hidden = client.patch(
        f"/api/courses/{scope['course_id']}/classes/{scope['class_id']}/release-plan",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "expected_version": 1,
            "items": [
                {"course_unit_id": scope["unit_one"]["id"], "release_mode": "hidden"}
            ],
        },
    )
    assert hidden.status_code == 200
    replay = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=payload,
    )
    assert replay.status_code == 200
    assert set(replay.json()) == {
        "event_id",
        "client_event_id",
        "event_type",
        "outcome",
        "received_at",
    }
    assert replay.json()["event_id"] == created.json()["event_id"]
    hidden_new = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json={
            **payload,
            "client_event_id": "release:hidden-new:0001",
        },
    )
    assert hidden_new.status_code == 403
    conflict_before_scope = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json={
            **payload,
            "evidence": {"cursor": {"step": 99}},
        },
    )
    assert conflict_before_scope.status_code == 409

    locked = client.patch(
        f"/api/courses/{scope['course_id']}/classes/{scope['class_id']}/release-plan",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "expected_version": 2,
            "items": [
                {"course_unit_id": scope["unit_one"]["id"], "release_mode": "locked"}
            ],
        },
    )
    assert locked.status_code == 200
    locked_new = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json={
            **payload,
            "client_event_id": "release:locked-new:0001",
        },
    )
    assert locked_new.status_code == 409
    opened = client.patch(
        f"/api/courses/{scope['course_id']}/classes/{scope['class_id']}/release-plan",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "expected_version": 3,
            "items": [
                {"course_unit_id": scope["unit_one"]["id"], "release_mode": "open"}
            ],
        },
    )
    assert opened.status_code == 200
    rebound = _activate_rule(
        client,
        scope,
        rule,
        expected_revision=activation["revision"],
        expected_plan_version=4,
    )
    assert rebound["revision"] == 2
    with get_session_factory(get_settings().database_url)() as db:
        db.execute(
            text("UPDATE courses SET status = 'archived' WHERE id = :course_id"),
            {"course_id": scope["course_id"]},
        )
        db.commit()
    archived_new = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json={
            **payload,
            "client_event_id": "release:archived-new:0001",
        },
    )
    assert archived_new.status_code == 403
    archived_replay = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=payload,
    )
    assert archived_replay.status_code == 200
    other_actor = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["other_student"]["token"]),
        json=payload,
    )
    assert other_actor.status_code == 403
    with get_session_factory(get_settings().database_url)() as db:
        assert (
            db.scalar(
                select(text("count(*)"))
                .select_from(LearningEvidenceEvent)
                .where(LearningEvidenceEvent.client_event_id == payload["client_event_id"])
            )
            == 1
        )


def test_locked_or_hidden_activity_never_returns_executable_resume(client):
    scope = _learning_scope(client, "resume-access")
    rule = _create_rule(client, scope)
    _activate_rule(client, scope, rule)
    now = datetime.now(UTC)
    started = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=_event_payload(
            scope,
            client_event_id="resume-access:started:0001",
            event_type="started",
            occurred_at=now,
        ),
    )
    assert started.status_code == 201
    attempted = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=_event_payload(
            scope,
            client_event_id="resume-access:attempted:0001",
            event_type="attempted",
            occurred_at=now + timedelta(seconds=1),
            evidence={
                "operation": "submit-answer",
                "cursor": {"step": 4, "panel": "analysis"},
            },
        ),
    )
    assert attempted.status_code == 201
    explained = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=_event_payload(
            scope,
            client_event_id="resume-access:explained:0001",
            event_type="explained",
            occurred_at=now + timedelta(seconds=2),
            evidence={"artifact": "Explanation saved without a cursor."},
        ),
    )
    assert explained.status_code == 201
    open_recovery = client.get(
        f"/api/learning-evidence/me/recovery?class_id={scope['class_id']}&course_id={scope['course_id']}",
        headers=_auth(scope["student"]["token"]),
    )
    assert open_recovery.status_code == 200
    assert open_recovery.json()["resume"]["course_unit_id"] == scope["unit_one"]["id"]
    assert open_recovery.json()["resume"]["last_event_id"] == explained.json()["event_id"]
    assert open_recovery.json()["resume"]["cursor"] == {
        "step": 4,
        "panel": "analysis",
    }
    open_activity = next(
        item
        for item in open_recovery.json()["activities"]
        if item["course_unit_id"] == scope["unit_one"]["id"]
    )
    assert open_activity["resume_cursor"] == {"step": 4, "panel": "analysis"}

    locked = client.patch(
        f"/api/courses/{scope['course_id']}/classes/{scope['class_id']}/release-plan",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "expected_version": 1,
            "items": [
                {"course_unit_id": scope["unit_one"]["id"], "release_mode": "locked"}
            ],
        },
    )
    assert locked.status_code == 200
    locked_recovery = client.get(
        f"/api/learning-evidence/me/recovery?class_id={scope['class_id']}&course_id={scope['course_id']}",
        headers=_auth(scope["student"]["token"]),
    )
    assert locked_recovery.status_code == 200, locked_recovery.json()
    assert locked_recovery.json()["resume"] is None
    locked_activity = next(
        activity
        for activity in locked_recovery.json()["activities"]
        if activity["course_unit_id"] == scope["unit_one"]["id"]
    )
    assert locked_activity["resume_cursor"] == {}

    hidden = client.patch(
        f"/api/courses/{scope['course_id']}/classes/{scope['class_id']}/release-plan",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "expected_version": 2,
            "items": [
                {"course_unit_id": scope["unit_one"]["id"], "release_mode": "hidden"}
            ],
        },
    )
    assert hidden.status_code == 200
    hidden_recovery = client.get(
        f"/api/learning-evidence/me/recovery?class_id={scope['class_id']}&course_id={scope['course_id']}",
        headers=_auth(scope["student"]["token"]),
    )
    assert hidden_recovery.status_code == 200
    assert hidden_recovery.json()["resume"] is None
    assert all(
        activity["course_unit_id"] != scope["unit_one"]["id"]
        for activity in hidden_recovery.json()["activities"]
    )
    assert "title" not in hidden_recovery.text.lower()
    assert "owner" not in hidden_recovery.text.lower()


def test_release_only_plan_revision_inherits_rule_binding_for_open_writes(client):
    scope = _learning_scope(client, "binding-inheritance")
    rule = _create_rule(client, scope)
    _activate_rule(client, scope, rule)
    release_change = client.patch(
        f"/api/courses/{scope['course_id']}/classes/{scope['class_id']}/release-plan",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "expected_version": 1,
            "items": [
                {"course_unit_id": scope["unit_two"]["id"], "release_mode": "locked"}
            ],
        },
    )
    assert release_change.status_code == 200
    assert release_change.json()["plan_version"] == 2

    inherited_write = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=_event_payload(
            scope,
            client_event_id="binding-inheritance:started:0001",
            event_type="started",
            occurred_at=datetime.now(UTC),
        ),
    )
    assert inherited_write.status_code == 201, inherited_write.json()
    recovery = client.get(
        f"/api/learning-evidence/me/recovery?class_id={scope['class_id']}&course_id={scope['course_id']}",
        headers=_auth(scope["student"]["token"]),
    )
    assert recovery.status_code == 200, recovery.json()
    assert recovery.json()["rule_version"] == rule["version_number"]
    assert recovery.json()["resume"]["course_unit_id"] == scope["unit_one"]["id"]
    projection = next(
        activity
        for activity in recovery.json()["activities"]
        if activity["course_unit_id"] == scope["unit_one"]["id"]
    )
    assert projection["rule_version"] == rule["version_number"]
    with get_session_factory(get_settings().database_url)() as db:
        bindings = list(
            db.scalars(
                select(LearningRuleClassBinding).where(
                    LearningRuleClassBinding.rule_id == rule["id"]
                )
            ).all()
        )
        assert [(binding.plan_version, binding.rule_version) for binding in bindings] == [
            (1, rule["version_number"])
        ]


def test_assignment_policy_is_enforced_for_authoritative_evidence(client):
    scope = _learning_scope(client, "assignment-policy")
    rule = _create_rule(client, scope)
    _activate_rule(client, scope, rule)
    assignment = client.post(
        (
            f"/api/courses/{scope['course_id']}/units/"
            f"{scope['unit_one']['id']}/assignments"
        ),
        headers=_auth(scope["teacher"]["token"]),
        json={
            "title": "Selected-class evidence task",
            "status": "active",
            "audience_mode": "selected_classes",
        },
    )
    assert assignment.status_code == 201, assignment.json()
    now = datetime.now(UTC)
    unassigned_payload = {
        **_event_payload(
            scope,
            client_event_id="assignment-policy:unassigned:0001",
            event_type="started",
            occurred_at=now,
        ),
        "assignment_id": assignment.json()["id"],
    }
    unassigned = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=unassigned_payload,
    )
    assert unassigned.status_code == 403
    assert unassigned.json()["detail"]["code"] == "assignment_not_assigned"

    inactive_policy = client.put(
        (
            f"/api/assignments/{assignment.json()['id']}/classes/"
            f"{scope['class_id']}/policy"
        ),
        headers=_auth(scope["teacher"]["token"]),
        json={"assigned": True, "status_override": "closed"},
    )
    assert inactive_policy.status_code == 200, inactive_policy.json()
    inactive = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json={
            **unassigned_payload,
            "client_event_id": "assignment-policy:inactive:0001",
        },
    )
    assert inactive.status_code == 409
    assert inactive.json()["detail"]["code"] == "assignment_inactive"

    active_policy = client.put(
        (
            f"/api/assignments/{assignment.json()['id']}/classes/"
            f"{scope['class_id']}/policy"
        ),
        headers=_auth(scope["teacher"]["token"]),
        json={"assigned": True, "status_override": "active"},
    )
    assert active_policy.status_code == 200, active_policy.json()
    accepted = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json={
            **unassigned_payload,
            "client_event_id": "assignment-policy:active:0001",
        },
    )
    assert accepted.status_code == 201, accepted.json()
    with get_session_factory(get_settings().database_url)() as db:
        assert (
            db.scalar(
                select(text("count(*)"))
                .select_from(LearningEvidenceEvent)
                .where(
                    LearningEvidenceEvent.client_event_id.in_(
                        [
                            "assignment-policy:unassigned:0001",
                            "assignment-policy:inactive:0001",
                        ]
                    )
                )
            )
            == 0
        )
        stored = db.scalar(
            select(LearningEvidenceEvent).where(
                LearningEvidenceEvent.client_event_id
                == "assignment-policy:active:0001"
            )
        )
        assert stored is not None
        assert stored.assignment_id == assignment.json()["id"]

    deleted_assignment = client.post(
        (
            f"/api/courses/{scope['course_id']}/units/"
            f"{scope['unit_one']['id']}/assignments"
        ),
        headers=_auth(scope["teacher"]["token"]),
        json={"title": "Deleted before locked policy read"},
    )
    assert deleted_assignment.status_code == 201, deleted_assignment.json()
    with get_session_factory(get_settings().database_url)() as db:
        stale_hint = db.get(Assignment, deleted_assignment.json()["id"])
        assert stale_hint is not None
        db.expunge(stale_hint)
    with get_session_factory(get_settings().database_url)() as db:
        persisted = db.get(Assignment, deleted_assignment.json()["id"])
        assert persisted is not None
        db.delete(persisted)
        db.commit()
    with get_session_factory(get_settings().database_url)() as db:
        with pytest.raises(HTTPException) as missing_after_hint:
            assignment_policies.resolve_assignment_class_policy(
                db,
                stale_hint,
                scope["class_id"],
                locking_read=True,
            )
        assert missing_after_hint.value.status_code == 404


def test_mutation_authorization_is_rechecked_after_revocation(client):
    scope = _learning_scope(client, "auth-revoke")
    editor = _login(client, "le_auth_revoke_editor", "teacher")
    with get_session_factory(get_settings().database_url)() as db:
        db.add(
            SchoolMembership(
                school_id=scope["school_id"],
                user_id=editor["id"],
                role="teacher",
                status="active",
            )
        )
        db.commit()
    collaborator = client.post(
        f"/api/courses/{scope['course_id']}/collaborators",
        headers=_auth(scope["teacher"]["token"]),
        json={"user_id": editor["id"], "role": "editor"},
    )
    assert collaborator.status_code == 201, collaborator.json()
    rule = _create_rule(client, scope)
    revoked = client.patch(
        (
            f"/api/courses/{scope['course_id']}/collaborators/"
            f"{collaborator.json()['id']}"
        ),
        headers=_auth(scope["teacher"]["token"]),
        json={"status": "inactive"},
    )
    assert revoked.status_code == 200, revoked.json()
    denied_activation = client.post(
        f"/api/learning-evidence/rules/{rule['id']}/activate",
        headers=_auth(editor["token"]),
        json={
            "expected_revision": 0,
            "class_bindings": [
                {
                    "class_id": scope["class_id"],
                    "expected_plan_version": 1,
                }
            ],
        },
    )
    assert denied_activation.status_code == 403
    with get_session_factory(get_settings().database_url)() as db:
        assert (
            db.scalar(
                select(text("count(*)")).select_from(LearningRuleActivation)
            )
            == 0
        )
        assert (
            db.scalar(
                select(text("count(*)")).select_from(LearningRuleClassBinding)
            )
            == 0
        )
        assert (
            db.scalar(
                select(text("count(*)"))
                .select_from(AuditLog)
                .where(AuditLog.action == "learning_evidence.rule.activate")
            )
            == 0
        )
    _activate_rule(client, scope, rule)
    now = datetime.now(UTC)
    source = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=_event_payload(
            scope,
            client_event_id="auth-revoke:source:0001",
            event_type="started",
            occurred_at=now,
        ),
    )
    assert source.status_code == 201

    with get_session_factory(get_settings().database_url)() as db:
        student_membership = db.scalar(
            select(ClassMembership).where(
                ClassMembership.class_id == scope["class_id"],
                ClassMembership.user_id == scope["student"]["id"],
                ClassMembership.role == "student",
            )
        )
        assert student_membership is not None
        student_membership.status = "inactive"
        db.commit()
    denied_learner = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=_event_payload(
            scope,
            client_event_id="auth-revoke:learner-denied:0001",
            event_type="started",
            occurred_at=now + timedelta(seconds=1),
        ),
    )
    assert denied_learner.status_code == 403
    with get_session_factory(get_settings().database_url)() as db:
        detached_teacher = db.get(User, scope["teacher"]["id"])
        assert detached_teacher is not None
        db.expunge(detached_teacher)
    with pytest.raises(HTTPException) as denied_trusted_subject:
        with get_session_factory(get_settings().database_url)() as db:
            append_trusted_assessment_result(
                db,
                actor=detached_teacher,
                client_event_id="auth-revoke:trusted-subject-denied:0001",
                subject_user_id=scope["student"]["id"],
                class_id=scope["class_id"],
                course_id=scope["course_id"],
                course_unit_id=scope["unit_one"]["id"],
                activity_key=scope["unit_one"]["activity_key"],
                rule_version=rule["version_number"],
                outcome="completed",
                source_ref="assessment:auth-revoke-subject",
                occurred_at=now + timedelta(seconds=1),
                evidence={},
            )
    assert denied_trusted_subject.value.status_code == 403
    with get_session_factory(get_settings().database_url)() as db:
        student_membership = db.scalar(
            select(ClassMembership).where(
                ClassMembership.class_id == scope["class_id"],
                ClassMembership.user_id == scope["student"]["id"],
                ClassMembership.role == "student",
            )
        )
        teacher_membership = db.scalar(
            select(ClassMembership).where(
                ClassMembership.class_id == scope["class_id"],
                ClassMembership.user_id == scope["teacher"]["id"],
                ClassMembership.role.in_(["teacher", "admin"]),
            )
        )
        assert student_membership is not None
        assert teacher_membership is not None
        student_membership.status = "active"
        teacher_membership.status = "inactive"
        db.commit()
        event_count_before = int(
            db.scalar(select(text("count(*)")).select_from(LearningEvidenceEvent))
            or 0
        )
        correction_audits_before = int(
            db.scalar(
                select(text("count(*)"))
                .select_from(AuditLog)
                .where(AuditLog.action == "learning_evidence.event.correct")
            )
            or 0
        )
    denied_correction = client.post(
        f"/api/learning-evidence/events/{source.json()['event_id']}/corrections",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "client_event_id": "auth-revoke:correction-denied:0001",
            "reason": "Teacher role was revoked before this mutation.",
            "occurred_at": (now + timedelta(seconds=2)).isoformat(),
        },
    )
    assert denied_correction.status_code == 403
    with pytest.raises(HTTPException) as denied_trusted_teacher:
        with get_session_factory(get_settings().database_url)() as db:
            append_trusted_assessment_result(
                db,
                actor=detached_teacher,
                client_event_id="auth-revoke:trusted-teacher-denied:0001",
                subject_user_id=scope["student"]["id"],
                class_id=scope["class_id"],
                course_id=scope["course_id"],
                course_unit_id=scope["unit_one"]["id"],
                activity_key=scope["unit_one"]["activity_key"],
                rule_version=rule["version_number"],
                outcome="completed",
                source_ref="assessment:auth-revoke-teacher",
                occurred_at=now + timedelta(seconds=2),
                evidence={},
            )
    assert denied_trusted_teacher.value.status_code == 403
    with get_session_factory(get_settings().database_url)() as db:
        assert (
            int(
                db.scalar(
                    select(text("count(*)")).select_from(LearningEvidenceEvent)
                )
                or 0
            )
            == event_count_before
        )
        assert (
            int(
                db.scalar(
                    select(text("count(*)"))
                    .select_from(AuditLog)
                    .where(AuditLog.action == "learning_evidence.event.correct")
                )
                or 0
            )
            == correction_audits_before
        )


def test_teacher_correction_obeys_release_gate_and_old_replay_is_minimal(client):
    scope = _learning_scope(client, "correction-release")
    rule = _create_rule(client, scope)
    _activate_rule(client, scope, rule)
    now = datetime.now(UTC)
    targets = []
    for index in range(4):
        response = client.post(
            "/api/learning-evidence/events",
            headers=_auth(scope["student"]["token"]),
            json=_event_payload(
                scope,
                client_event_id=f"correction-release:attempt:{index:04d}",
                event_type="attempted",
                occurred_at=now + timedelta(microseconds=index),
                evidence={"operation": f"release-check-{index}"},
            ),
        )
        assert response.status_code == 201, response.json()
        targets.append(response.json()["event_id"])
    accepted_payload = {
        "client_event_id": "correction-release:accepted:0001",
        "reason": "教师确认该历史尝试无效。",
        "occurred_at": (now + timedelta(seconds=1)).isoformat(),
    }
    accepted = client.post(
        f"/api/learning-evidence/events/{targets[0]}/corrections",
        headers=_auth(scope["teacher"]["token"]),
        json=accepted_payload,
    )
    assert accepted.status_code == 201, accepted.json()
    with get_session_factory(get_settings().database_url)() as db:
        event_count = int(
            db.scalar(
                select(text("count(*)")).select_from(LearningEvidenceEvent)
            )
            or 0
        )
        audit_count = int(
            db.scalar(
                select(text("count(*)"))
                .select_from(AuditLog)
                .where(
                    AuditLog.action == "learning_evidence.event.correct"
                )
            )
            or 0
        )
        projection = db.scalar(
            select(LearningActivityProjection).where(
                LearningActivityProjection.subject_user_id
                == scope["student"]["id"],
                LearningActivityProjection.course_unit_id
                == scope["unit_one"]["id"],
            )
        )
        assert projection is not None
        projection_revision = projection.projection_revision

    hidden = client.patch(
        (
            f"/api/courses/{scope['course_id']}/classes/"
            f"{scope['class_id']}/release-plan"
        ),
        headers=_auth(scope["teacher"]["token"]),
        json={
            "expected_version": 1,
            "items": [
                {
                    "course_unit_id": scope["unit_one"]["id"],
                    "release_mode": "hidden",
                }
            ],
        },
    )
    assert hidden.status_code == 200, hidden.json()
    replay = client.post(
        f"/api/learning-evidence/events/{targets[0]}/corrections",
        headers=_auth(scope["teacher"]["token"]),
        json=accepted_payload,
    )
    assert replay.status_code == 200, replay.json()
    assert replay.json()["outcome"] == "duplicate"
    assert replay.json()["event_id"] == accepted.json()["event_id"]
    assert set(replay.json()) == {
        "event_id",
        "client_event_id",
        "event_type",
        "outcome",
        "received_at",
    }
    hidden_denied = client.post(
        f"/api/learning-evidence/events/{targets[1]}/corrections",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "client_event_id": "correction-release:hidden:0001",
            "reason": "Hidden resources reject new corrections.",
            "occurred_at": (now + timedelta(seconds=2)).isoformat(),
        },
    )
    assert hidden_denied.status_code == 403

    locked = client.patch(
        (
            f"/api/courses/{scope['course_id']}/classes/"
            f"{scope['class_id']}/release-plan"
        ),
        headers=_auth(scope["teacher"]["token"]),
        json={
            "expected_version": 2,
            "items": [
                {
                    "course_unit_id": scope["unit_one"]["id"],
                    "release_mode": "locked",
                }
            ],
        },
    )
    assert locked.status_code == 200, locked.json()
    locked_denied = client.post(
        f"/api/learning-evidence/events/{targets[2]}/corrections",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "client_event_id": "correction-release:locked:0001",
            "reason": "Locked resources reject new corrections.",
            "occurred_at": (now + timedelta(seconds=3)).isoformat(),
        },
    )
    assert locked_denied.status_code == 409

    opened = client.patch(
        (
            f"/api/courses/{scope['course_id']}/classes/"
            f"{scope['class_id']}/release-plan"
        ),
        headers=_auth(scope["teacher"]["token"]),
        json={
            "expected_version": 3,
            "items": [
                {
                    "course_unit_id": scope["unit_one"]["id"],
                    "release_mode": "open",
                }
            ],
        },
    )
    assert opened.status_code == 200, opened.json()
    with get_session_factory(get_settings().database_url)() as db:
        unit = db.get(CourseUnit, scope["unit_one"]["id"])
        assert unit is not None
        unit.status = "archived"
        db.commit()
    archived_denied = client.post(
        f"/api/learning-evidence/events/{targets[3]}/corrections",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "client_event_id": "correction-release:archived:0001",
            "reason": "Archived resources reject new corrections.",
            "occurred_at": (now + timedelta(seconds=4)).isoformat(),
        },
    )
    assert archived_denied.status_code == 403
    with get_session_factory(get_settings().database_url)() as db:
        assert (
            int(
                db.scalar(
                    select(text("count(*)")).select_from(
                        LearningEvidenceEvent
                    )
                )
                or 0
            )
            == event_count
        )
        assert (
            int(
                db.scalar(
                    select(text("count(*)"))
                    .select_from(AuditLog)
                    .where(
                        AuditLog.action
                        == "learning_evidence.event.correct"
                    )
                )
                or 0
            )
            == audit_count
        )
        for client_event_id in (
            "correction-release:hidden:0001",
            "correction-release:locked:0001",
            "correction-release:archived:0001",
        ):
            assert (
                db.scalar(
                    select(LearningEvidenceEvent.id).where(
                        LearningEvidenceEvent.client_event_id
                        == client_event_id
                    )
                )
                is None
            )
        projection = db.scalar(
            select(LearningActivityProjection).where(
                LearningActivityProjection.subject_user_id
                == scope["student"]["id"],
                LearningActivityProjection.course_unit_id
                == scope["unit_one"]["id"],
            )
        )
        assert projection is not None
        assert projection.projection_revision == projection_revision


def test_teacher_append_only_correction_rebuild_and_zero_side_effect_denial(client):
    scope = _learning_scope(client, "correction")
    rule = _create_rule(client, scope)
    _activate_rule(client, scope, rule)
    now = datetime.now(UTC)
    started = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=_event_payload(
            scope,
            client_event_id="correction:started:0001",
            event_type="started",
            occurred_at=now - timedelta(minutes=1),
        ),
    )
    attempted_payload = _event_payload(
        scope,
        client_event_id="correction:attempted:0001",
        event_type="attempted",
        occurred_at=now,
        evidence={"operation": "submit-answer", "reported_correct": True},
    )
    attempted = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=attempted_payload,
    )
    assert started.status_code == 201
    assert attempted.status_code == 201
    with get_session_factory(get_settings().database_url)() as db:
        event_count_before_blank_reason = int(
            db.scalar(select(text("count(*)")).select_from(LearningEvidenceEvent))
            or 0
        )
    blank_reason = client.post(
        f"/api/learning-evidence/events/{attempted.json()['event_id']}/corrections",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "client_event_id": "teacher:blank-correction:0001",
            "reason": " \t ",
            "occurred_at": (now + timedelta(milliseconds=100)).isoformat(),
        },
    )
    assert blank_reason.status_code == 422
    correction_typo = client.post(
        f"/api/learning-evidence/events/{attempted.json()['event_id']}/corrections",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "client_event_id": "teacher:typo-correction:0001",
            "reasno": "This misspelled field must never be ignored.",
            "occurred_at": (now + timedelta(milliseconds=200)).isoformat(),
        },
    )
    assert correction_typo.status_code == 422
    with get_session_factory(get_settings().database_url)() as db:
        assert (
            int(
                db.scalar(
                    select(text("count(*)")).select_from(LearningEvidenceEvent)
                )
                or 0
            )
            == event_count_before_blank_reason
        )
    with get_session_factory(get_settings().database_url)() as db:
        derived = db.scalar(
            select(LearningEvidenceEvent).where(
                LearningEvidenceEvent.subject_user_id == scope["student"]["id"],
                LearningEvidenceEvent.producer_type == "rule",
                LearningEvidenceEvent.event_type == "completed",
            )
        )
        assert derived is not None
        derived_event_id = derived.id
        event_count_before_derived_denial = int(
            db.scalar(select(text("count(*)")).select_from(LearningEvidenceEvent))
            or 0
        )
        correction_audits_before = int(
            db.scalar(
                select(text("count(*)"))
                .select_from(AuditLog)
                .where(AuditLog.action == "learning_evidence.event.correct")
            )
            or 0
        )
        projection_before = db.scalar(
            select(LearningActivityProjection).where(
                LearningActivityProjection.subject_user_id == scope["student"]["id"],
                LearningActivityProjection.course_unit_id == scope["unit_one"]["id"],
            )
        )
        assert projection_before is not None
        projection_revision_before = projection_before.projection_revision
    derived_denied = client.post(
        f"/api/learning-evidence/events/{derived_event_id}/corrections",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "client_event_id": "teacher:derived-correction:0001",
            "reason": "Attempt to override a rule result directly.",
            "occurred_at": (now + timedelta(milliseconds=500)).isoformat(),
        },
    )
    assert derived_denied.status_code == 409
    assert derived_denied.json()["detail"]["code"] == "correction_target_derived"
    with get_session_factory(get_settings().database_url)() as db:
        assert (
            int(
                db.scalar(
                    select(text("count(*)")).select_from(LearningEvidenceEvent)
                )
                or 0
            )
            == event_count_before_derived_denial
        )
        assert (
            int(
                db.scalar(
                    select(text("count(*)"))
                    .select_from(AuditLog)
                    .where(AuditLog.action == "learning_evidence.event.correct")
                )
                or 0
            )
            == correction_audits_before
        )
        projection_after_denial = db.scalar(
            select(LearningActivityProjection).where(
                LearningActivityProjection.subject_user_id == scope["student"]["id"],
                LearningActivityProjection.course_unit_id == scope["unit_one"]["id"],
            )
        )
        assert projection_after_denial is not None
        assert (
            projection_after_denial.projection_revision
            == projection_revision_before
        )
    correction_payload = {
        "client_event_id": "teacher:administrative-correction:0001",
        "reason": "The imported assessment result was associated with the wrong attempt.",
        "occurred_at": (now + timedelta(seconds=1)).isoformat(),
    }
    denied = client.post(
        f"/api/learning-evidence/events/{attempted.json()['event_id']}/corrections",
        headers=_auth(scope["outsider_teacher"]["token"]),
        json=correction_payload,
    )
    assert denied.status_code == 403
    with get_session_factory(get_settings().database_url)() as db:
        before_count = int(
            db.scalar(select(text("count(*)")).select_from(LearningEvidenceEvent)) or 0
        )
    corrected = client.post(
        f"/api/learning-evidence/events/{attempted.json()['event_id']}/corrections",
        headers=_auth(scope["teacher"]["token"]),
        json=correction_payload,
    )
    assert corrected.status_code == 201, corrected.json()
    correction_replay = client.post(
        f"/api/learning-evidence/events/{attempted.json()['event_id']}/corrections",
        headers=_auth(scope["teacher"]["token"]),
        json=correction_payload,
    )
    assert correction_replay.status_code == 200
    second_correction = client.post(
        f"/api/learning-evidence/events/{attempted.json()['event_id']}/corrections",
        headers=_auth(scope["teacher"]["token"]),
        json={
            **correction_payload,
            "client_event_id": "teacher:administrative-correction:conflict",
        },
    )
    assert second_correction.status_code == 409
    assert second_correction.json()["detail"]["code"] == "event_already_corrected"
    recovery = client.get(
        f"/api/learning-evidence/me/recovery?class_id={scope['class_id']}&course_id={scope['course_id']}",
        headers=_auth(scope["student"]["token"]),
    )
    assert recovery.status_code == 200
    projection = next(
        item
        for item in recovery.json()["activities"]
        if item["course_unit_id"] == scope["unit_one"]["id"]
    )
    assert projection["status"] == "in_progress"
    assert projection["attempt_count"] == 0
    assert projection["completed_at"] is None
    aggregate = client.get(
        f"/api/learning-evidence/classes/{scope['class_id']}/courses/{scope['course_id']}/aggregate",
        headers=_auth(scope["teacher"]["token"]),
    )
    assert aggregate.status_code == 200
    assert aggregate.json()["activities"][0]["completed"] == 0

    with get_session_factory(get_settings().database_url)() as db:
        target = db.get(LearningEvidenceEvent, attempted.json()["event_id"])
        assert target is not None
        assert target.event_type == "attempted"
        assert target.evidence_json["reported_correct"] is True
        correction = db.get(LearningEvidenceEvent, corrected.json()["event_id"])
        assert correction.corrects_event_id == target.id
        assert correction.event_type == "administrative_correction"
        assert correction.event_schema_version == CURRENT_EVENT_SCHEMA_VERSION
        after_count = int(
            db.scalar(select(text("count(*)")).select_from(LearningEvidenceEvent)) or 0
        )
        assert after_count == before_count + 1
        activity = db.scalar(
            select(LearningActivityProjection).where(
                LearningActivityProjection.subject_user_id == scope["student"]["id"],
                LearningActivityProjection.course_unit_id == scope["unit_one"]["id"],
            )
        )
        assert activity is not None
        activity.status = "completed"
        db.commit()
    rebuilt = client.post(
        f"/api/learning-evidence/classes/{scope['class_id']}/courses/{scope['course_id']}/rebuild"
        f"?subject_user_id={scope['student']['id']}",
        headers=_auth(scope["teacher"]["token"]),
    )
    assert rebuilt.status_code == 200, rebuilt.json()
    assert rebuilt.json()["rebuilt_activities"] == 1
    repaired = client.get(
        f"/api/learning-evidence/me/recovery?class_id={scope['class_id']}&course_id={scope['course_id']}",
        headers=_auth(scope["student"]["token"]),
    )
    assert repaired.json()["activities"][0]["status"] == "in_progress"

    replacement = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json={
            **attempted_payload,
            "client_event_id": "correction:attempted:0002",
            "occurred_at": (now + timedelta(seconds=2)).isoformat(),
        },
    )
    assert replacement.status_code == 201
    completed_again = client.get(
        f"/api/learning-evidence/me/recovery?class_id={scope['class_id']}&course_id={scope['course_id']}",
        headers=_auth(scope["student"]["token"]),
    )
    assert completed_again.json()["activities"][0]["status"] == "completed"
    correction_of_correction = client.post(
        f"/api/learning-evidence/events/{corrected.json()['event_id']}/corrections",
        headers=_auth(scope["teacher"]["token"]),
        json={
            **correction_payload,
            "client_event_id": "teacher:administrative-correction:0002",
        },
    )
    assert correction_of_correction.status_code == 409


def test_correction_keeps_minimal_witness_or_appends_replacement_derived_event(client):
    scope = _learning_scope(client, "correction-witness")
    rule = _create_rule(client, scope)
    _activate_rule(client, scope, rule)
    now = datetime.now(UTC)

    first_started = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=_event_payload(
            scope,
            client_event_id="witness:first:started:0001",
            event_type="started",
            occurred_at=now - timedelta(minutes=3),
        ),
    )
    irrelevant_prediction = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=_event_payload(
            scope,
            client_event_id="witness:first:predicted:0001",
            event_type="predicted",
            occurred_at=now - timedelta(minutes=2),
            evidence={"prediction": "unrelated"},
        ),
    )
    first_attempt = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=_event_payload(
            scope,
            client_event_id="witness:first:attempted:0001",
            event_type="attempted",
            occurred_at=now - timedelta(minutes=1),
            evidence={"operation": "submit-answer", "reported_correct": True},
        ),
    )
    assert first_started.status_code == 201
    assert irrelevant_prediction.status_code == 201
    assert first_attempt.status_code == 201
    with get_session_factory(get_settings().database_url)() as db:
        first_events_before = list(
            db.scalars(
                select(LearningEvidenceEvent)
                .where(
                    LearningEvidenceEvent.subject_user_id == scope["student"]["id"],
                    LearningEvidenceEvent.course_unit_id == scope["unit_one"]["id"],
                )
                .order_by(LearningEvidenceEvent.id)
            ).all()
        )
        first_derived_before = [
            event for event in first_events_before if event.producer_type == "rule"
        ]
        assert len(first_events_before) == 4
        assert len(first_derived_before) == 1
        assert irrelevant_prediction.json()["event_id"] not in (
            first_derived_before[0].source_event_ids_json
        )

    corrected_prediction = client.post(
        f"/api/learning-evidence/events/{irrelevant_prediction.json()['event_id']}/corrections",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "client_event_id": "witness:first:correction:0001",
            "reason": "Prediction was imported from the wrong draft.",
            "occurred_at": datetime.now(UTC).isoformat(),
        },
    )
    assert corrected_prediction.status_code == 201
    first_recovery = client.get(
        f"/api/learning-evidence/me/recovery?class_id={scope['class_id']}&course_id={scope['course_id']}",
        headers=_auth(scope["student"]["token"]),
    )
    assert first_recovery.status_code == 200
    assert first_recovery.json()["activities"][0]["status"] == "completed"
    with get_session_factory(get_settings().database_url)() as db:
        first_events_after = list(
            db.scalars(
                select(LearningEvidenceEvent).where(
                    LearningEvidenceEvent.subject_user_id == scope["student"]["id"],
                    LearningEvidenceEvent.course_unit_id == scope["unit_one"]["id"],
                )
            ).all()
        )
        assert len(first_events_after) == 5
        assert sum(event.producer_type == "rule" for event in first_events_after) == 1

    second_started = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["other_student"]["token"]),
        json=_event_payload(
            scope,
            client_event_id="witness:second:started:0001",
            event_type="started",
            occurred_at=now - timedelta(minutes=3),
        ),
    )
    selected_attempt = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["other_student"]["token"]),
        json=_event_payload(
            scope,
            client_event_id="witness:second:attempted:0001",
            event_type="attempted",
            occurred_at=now - timedelta(minutes=2),
            evidence={"operation": "submit-answer", "reported_correct": True},
        ),
    )
    replacement_attempt = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["other_student"]["token"]),
        json=_event_payload(
            scope,
            client_event_id="witness:second:attempted:0002",
            event_type="attempted",
            occurred_at=now - timedelta(minutes=1),
            evidence={"operation": "submit-answer", "reported_correct": True},
        ),
    )
    assert second_started.status_code == 201
    assert selected_attempt.status_code == 201
    assert replacement_attempt.status_code == 201
    corrected_selected_attempt = client.post(
        f"/api/learning-evidence/events/{selected_attempt.json()['event_id']}/corrections",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "client_event_id": "witness:second:correction:0001",
            "reason": "The first attempt was attached to the wrong learner response.",
            "occurred_at": datetime.now(UTC).isoformat(),
        },
    )
    assert corrected_selected_attempt.status_code == 201
    second_recovery = client.get(
        f"/api/learning-evidence/me/recovery?class_id={scope['class_id']}&course_id={scope['course_id']}",
        headers=_auth(scope["other_student"]["token"]),
    )
    assert second_recovery.status_code == 200
    assert second_recovery.json()["activities"][0]["status"] == "completed"
    with get_session_factory(get_settings().database_url)() as db:
        second_events = list(
            db.scalars(
                select(LearningEvidenceEvent)
                .where(
                    LearningEvidenceEvent.subject_user_id
                    == scope["other_student"]["id"],
                    LearningEvidenceEvent.course_unit_id == scope["unit_one"]["id"],
                )
                .order_by(LearningEvidenceEvent.id)
            ).all()
        )
        second_derived = [
            event for event in second_events if event.producer_type == "rule"
        ]
        assert len(second_events) == 6
        assert len(second_derived) == 2
        assert selected_attempt.json()["event_id"] in second_derived[0].source_event_ids_json
        assert selected_attempt.json()["event_id"] not in second_derived[1].source_event_ids_json
        assert replacement_attempt.json()["event_id"] in second_derived[1].source_event_ids_json


def test_batch_results_and_concurrent_exact_replay(client):
    scope = _learning_scope(client, "batch")
    rule = _create_rule(client, scope)
    _activate_rule(client, scope, rule)
    now = datetime.now(UTC)
    strict_batch = client.post(
        "/api/learning-evidence/events/batch",
        headers=_auth(scope["student"]["token"]),
        json={
            "items": [
                _event_payload(
                    scope,
                    client_event_id="batch:outer-typo:0001",
                    event_type="started",
                    occurred_at=now,
                )
            ],
            "atomci": True,
        },
    )
    assert strict_batch.status_code == 422
    with get_session_factory(get_settings().database_url)() as db:
        assert (
            db.scalar(
                select(text("count(*)"))
                .select_from(LearningEvidenceEvent)
                .where(
                    LearningEvidenceEvent.client_event_id
                    == "batch:outer-typo:0001"
                )
            )
            == 0
        )
    batch = client.post(
        "/api/learning-evidence/events/batch",
        headers=_auth(scope["student"]["token"]),
        json={
            "items": [
                _event_payload(
                    scope,
                    client_event_id="batch:accepted:0001",
                    event_type="started",
                    occurred_at=now,
                ),
                _event_payload(
                    scope,
                    client_event_id="batch:stale-rule:0001",
                    event_type="started",
                    occurred_at=now,
                    rule_version=99,
                ),
            ]
        },
    )
    assert batch.status_code == 200, batch.json()
    assert batch.json()["accepted_count"] == 1
    assert batch.json()["conflict_count"] == 1
    assert batch.json()["items"][1]["error_code"] == "rule_version_conflict"

    concurrent_payload = _event_payload(
        scope,
        client_event_id="concurrent:exact-replay:0001",
        event_type="predicted",
        occurred_at=now + timedelta(seconds=1),
        evidence={"prediction": "stable"},
    )
    barrier = Barrier(2)
    command = LearnerEvidenceEventCreate.model_validate(concurrent_payload)
    with get_session_factory(get_settings().database_url)() as db:
        detached_student = db.get(User, scope["student"]["id"])
        assert detached_student is not None
        db.expunge(detached_student)

    def append_once():
        barrier.wait(timeout=5)
        with get_session_factory(get_settings().database_url)() as db:
            return append_learner_event(db, actor=detached_student, payload=command)

    with ThreadPoolExecutor(max_workers=2) as pool:
        receipts = [
            future.result(timeout=10)
            for future in [
                pool.submit(append_once),
                pool.submit(append_once),
            ]
        ]
    assert sorted(receipt["outcome"] for receipt in receipts) == ["accepted", "duplicate"]
    assert len({receipt["event_id"] for receipt in receipts}) == 1
    with get_session_factory(get_settings().database_url)() as db:
        count = int(
            db.scalar(
                select(text("count(*)"))
                .select_from(LearningEvidenceEvent)
                .where(
                    LearningEvidenceEvent.client_event_id
                    == concurrent_payload["client_event_id"]
                )
            )
            or 0
        )
        assert count == 1


def test_large_attempt_batch_keeps_projection_and_derived_witness_bounded(client):
    scope = _learning_scope(client, "bounded-witness")
    rule = _create_rule(client, scope)
    _activate_rule(client, scope, rule)
    now = datetime.now(UTC)
    started = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=_event_payload(
            scope,
            client_event_id="bounded-witness:started:0001",
            event_type="started",
            occurred_at=now,
        ),
    )
    assert started.status_code == 201, started.json()
    attempted_payloads = [
        _event_payload(
            scope,
            client_event_id=f"bounded-witness:attempt:{index:04d}",
            event_type="attempted",
            occurred_at=now + timedelta(microseconds=index + 1),
            evidence={
                "operation": "submit-observation",
                "reported_correct": index % 2 == 0,
            },
        )
        for index in range(MAX_RULE_WITNESS_EVENTS)
    ]
    batch = client.post(
        "/api/learning-evidence/events/batch",
        headers=_auth(scope["student"]["token"]),
        json={"items": attempted_payloads},
    )
    assert batch.status_code == 200, batch.json()
    assert batch.json()["accepted_count"] == MAX_RULE_WITNESS_EVENTS
    assert batch.json()["duplicate_count"] == 0

    exact_replay = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=attempted_payloads[-1],
    )
    assert exact_replay.status_code == 200, exact_replay.json()
    assert exact_replay.json()["outcome"] == "duplicate"

    with get_session_factory(get_settings().database_url)() as db:
        events = list(
            db.scalars(
                select(LearningEvidenceEvent)
                .where(
                    LearningEvidenceEvent.subject_user_id
                    == scope["student"]["id"],
                    LearningEvidenceEvent.course_unit_id
                    == scope["unit_one"]["id"],
                )
                .order_by(LearningEvidenceEvent.id)
            ).all()
        )
        derived = [event for event in events if event.producer_type == "rule"]
        assert len(derived) == 1
        assert derived[0].source_event_ids_json == [
            started.json()["event_id"],
            batch.json()["items"][0]["receipt"]["event_id"],
        ]
        assert (
            len(derived[0].source_event_ids_json)
            <= MAX_RULE_WITNESS_EVENTS
        )
        projection = db.scalar(
            select(LearningActivityProjection).where(
                LearningActivityProjection.subject_user_id
                == scope["student"]["id"],
                LearningActivityProjection.course_unit_id
                == scope["unit_one"]["id"],
                LearningActivityProjection.rule_id == rule["id"],
            )
        )
        assert projection is not None
        assert projection.status == "completed"
        assert projection.learner_event_count == MAX_RULE_WITNESS_EVENTS + 1
        assert projection.attempt_count == MAX_RULE_WITNESS_EVENTS


def test_concurrent_distinct_facts_complete_once_without_projection_lost_update(client):
    scope = _learning_scope(client, "concurrent-facts")
    rule = _create_rule(client, scope)
    _activate_rule(client, scope, rule)
    now = datetime.now(UTC)
    commands = [
        LearnerEvidenceEventCreate.model_validate(
            _event_payload(
                scope,
                client_event_id="concurrent-facts:started:0001",
                event_type="started",
                occurred_at=now - timedelta(seconds=1),
                evidence={"cursor": {"step": 1}},
            )
        ),
        LearnerEvidenceEventCreate.model_validate(
            _event_payload(
                scope,
                client_event_id="concurrent-facts:attempted:0001",
                event_type="attempted",
                occurred_at=now,
                evidence={
                    "operation": "submit-answer",
                    "cursor": {"step": 2},
                },
            )
        ),
    ]
    with get_session_factory(get_settings().database_url)() as db:
        detached_student = db.get(User, scope["student"]["id"])
        assert detached_student is not None
        db.expunge(detached_student)
    barrier = Barrier(2)

    def append(command):
        barrier.wait(timeout=5)
        with get_session_factory(get_settings().database_url)() as db:
            return append_learner_event(
                db,
                actor=detached_student,
                payload=command,
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        receipts = [
            future.result(timeout=10)
            for future in [pool.submit(append, command) for command in commands]
        ]
    assert {receipt["outcome"] for receipt in receipts} == {"accepted"}
    with get_session_factory(get_settings().database_url)() as db:
        events = list(
            db.scalars(
                select(LearningEvidenceEvent)
                .where(
                    LearningEvidenceEvent.subject_user_id
                    == scope["student"]["id"],
                    LearningEvidenceEvent.course_unit_id
                    == scope["unit_one"]["id"],
                )
                .order_by(LearningEvidenceEvent.id)
            ).all()
        )
        assert sum(event.producer_type == "learner" for event in events) == 2
        derived = [event for event in events if event.producer_type == "rule"]
        assert len(derived) == 1
        assert derived[0].event_type == "completed"
        assert derived[0].client_event_id.startswith(
            RULE_DERIVED_CLIENT_EVENT_PREFIX
        )
        assert derived[0].subject_user_id == scope["student"]["id"]
        assert derived[0].rule_id == rule["id"]
        assert set(derived[0].source_event_ids_json) == {
            event.id for event in events if event.producer_type == "learner"
        }
        projection = db.scalar(
            select(LearningActivityProjection).where(
                LearningActivityProjection.subject_user_id
                == scope["student"]["id"],
                LearningActivityProjection.course_unit_id
                == scope["unit_one"]["id"],
                LearningActivityProjection.rule_id == rule["id"],
            )
        )
        assert projection is not None
        assert projection.status == "completed"
        assert projection.learner_event_count == 2
        assert projection.attempt_count == 1
        assert projection.resume_cursor_json == {"step": 2}
        resume = db.scalar(
            select(LearningResumeProjection).where(
                LearningResumeProjection.subject_user_id
                == scope["student"]["id"],
                LearningResumeProjection.rule_id == rule["id"],
            )
        )
        assert resume is not None
        assert resume.cursor_json == {"step": 2}


def test_waiting_rebuild_preserves_writer_commit_and_current_projection(
    client,
    monkeypatch,
):
    scope = _learning_scope(client, "rebuild-current")
    rule = _create_rule(client, scope)
    _activate_rule(client, scope, rule)
    now = datetime.now(UTC)
    started = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=_event_payload(
            scope,
            client_event_id="rebuild-current:started:0001",
            event_type="started",
            occurred_at=now - timedelta(seconds=1),
        ),
    )
    assert started.status_code == 201
    attempted_command = LearnerEvidenceEventCreate.model_validate(
        _event_payload(
            scope,
            client_event_id="rebuild-current:attempted:0001",
            event_type="attempted",
            occurred_at=now,
            evidence={"operation": "submit-answer"},
        )
    )
    with get_session_factory(get_settings().database_url)() as db:
        detached_student = db.get(User, scope["student"]["id"])
        detached_teacher = db.get(User, scope["teacher"]["id"])
        assert detached_student is not None
        assert detached_teacher is not None
        db.expunge(detached_student)
        db.expunge(detached_teacher)

    writer_inserted = Event()
    allow_writer = Event()
    rebuild_requested = Event()
    original_insert = learning_evidence_service._insert_event_or_resolve_replay

    def pause_after_learner_insert(db, event):
        inserted = original_insert(db, event)
        if (
            event.client_event_id == "rebuild-current:attempted:0001"
            and event.producer_type == "learner"
        ):
            writer_inserted.set()
            assert allow_writer.wait(timeout=5)
        return inserted

    monkeypatch.setattr(
        learning_evidence_service,
        "_insert_event_or_resolve_replay",
        pause_after_learner_insert,
    )

    def append_writer():
        with get_session_factory(get_settings().database_url)() as db:
            return append_learner_event(
                db,
                actor=detached_student,
                payload=attempted_command,
            )

    def run_rebuild():
        rebuild_requested.set()
        with get_session_factory(get_settings().database_url)() as db:
            return rebuild_learning_projections(
                db,
                actor=detached_teacher,
                class_id=scope["class_id"],
                course_id=scope["course_id"],
                subject_user_id=scope["student"]["id"],
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        writer_future = pool.submit(append_writer)
        assert writer_inserted.wait(timeout=5)
        rebuild_future = pool.submit(run_rebuild)
        assert rebuild_requested.wait(timeout=5)
        allow_writer.set()
        assert writer_future.result(timeout=10)["outcome"] == "accepted"
        rebuilt = rebuild_future.result(timeout=10)
    assert rebuilt["rebuilt_activities"] == 1
    with get_session_factory(get_settings().database_url)() as db:
        events = list(
            db.scalars(
                select(LearningEvidenceEvent).where(
                    LearningEvidenceEvent.subject_user_id
                    == scope["student"]["id"],
                    LearningEvidenceEvent.course_unit_id
                    == scope["unit_one"]["id"],
                )
            ).all()
        )
        assert sum(event.producer_type == "learner" for event in events) == 2
        assert sum(event.producer_type == "rule" for event in events) == 1
        projection = db.scalar(
            select(LearningActivityProjection).where(
                LearningActivityProjection.subject_user_id
                == scope["student"]["id"],
                LearningActivityProjection.course_unit_id
                == scope["unit_one"]["id"],
            )
        )
        assert projection is not None
        assert projection.status == "completed"
        assert projection.learner_event_count == 2


def test_legacy_complete_cutoff_preserves_migrated_access_without_mastery(client):
    scope = _learning_scope(client, "legacy")
    rejected_complete = client.post(
        "/api/learning-events",
        headers=_auth(scope["student"]["token"]),
        json={
            "class_id": scope["class_id"],
            "unit_id": scope["unit_one"]["id"],
            "event_type": "complete",
            "payload": {"legacy": True},
        },
    )
    assert rejected_complete.status_code == 409
    with get_session_factory(get_settings().database_url)() as db:
        assert db.scalar(select(text("count(*)")).select_from(LearningEvent)) == 0
        assert (
            db.scalar(
                select(text("count(*)")).select_from(LegacyAccessEntitlement)
            )
            == 0
        )
        legacy_event = LearningEvent(
            user_id=scope["student"]["id"],
            school_id=scope["school_id"],
            class_id=scope["class_id"],
            course_id=scope["course_id"],
            unit_id=scope["unit_one"]["id"],
            event_type="complete",
            payload={"pre_cutoff": True},
            occurred_at=datetime.now(UTC) - timedelta(days=1),
        )
        db.add(legacy_event)
        db.flush([legacy_event])
        db.add(
            LegacyAccessEntitlement(
                entitlement_key="a" * 64,
                subject_user_id=scope["student"]["id"],
                class_id=scope["class_id"],
                prerequisite_unit_id=scope["unit_one"]["id"],
                source_learning_event_id=legacy_event.id,
                source_event_kind="legacy_complete",
                migration_revision="20260727_0051",
                created_at=legacy_event.occurred_at,
            )
        )
        db.commit()
    plan = client.patch(
        f"/api/courses/{scope['course_id']}/classes/{scope['class_id']}/release-plan",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "expected_version": 1,
            "items": [
                {
                    "course_unit_id": scope["unit_two"]["id"],
                    "prerequisite_unit_id": scope["unit_one"]["id"],
                }
            ],
        },
    )
    assert plan.status_code == 200, plan.json()
    units = client.get(
        f"/api/courses/{scope['course_id']}/units?class_id={scope['class_id']}",
        headers=_auth(scope["student"]["token"]),
    )
    assert units.status_code == 200, units.json()
    second = next(item for item in units.json() if item["id"] == scope["unit_two"]["id"])
    assert second["effective_release_state"] == "open"
    rule = _create_rule(client, scope)
    _activate_rule(client, scope, rule, expected_plan_version=2)
    matrix = client.get(
        (
            f"/api/progress/courses/{scope['course_id']}/classes/"
            f"{scope['class_id']}/students"
        ),
        headers=_auth(scope["teacher"]["token"]),
    )
    assert matrix.status_code == 200, matrix.json()
    student_row = next(
        row
        for row in matrix.json()["items"]
        if row["student_id"] == scope["student"]["id"]
    )
    foundation = next(
        block
        for block in student_row["blocks"]
        if block["course_unit_id"] == scope["unit_one"]["id"]
    )
    assert foundation["started"] is True
    assert foundation["completed"] is False
    progress = client.get(
        f"/api/progress/me?class_id={scope['class_id']}",
        headers=_auth(scope["student"]["token"]),
    )
    assert progress.status_code == 200, progress.json()
    assert progress.json()["learning_events"] == 1
    assert progress.json()["completed_events"] == 0
    assert progress.json()["completion_percent"] == 0.0
    aggregate = client.get(
        (
            f"/api/learning-evidence/classes/{scope['class_id']}/courses/"
            f"{scope['course_id']}/aggregate"
        ),
        headers=_auth(scope["teacher"]["token"]),
    )
    assert aggregate.status_code == 200, aggregate.json()
    assert aggregate.json()["activities"][0]["completed"] == 0

    now = datetime.now(UTC)
    for payload in (
        _event_payload(
            scope,
            client_event_id="legacy-cutoff:started:0001",
            event_type="started",
            occurred_at=now - timedelta(seconds=1),
        ),
        _event_payload(
            scope,
            client_event_id="legacy-cutoff:attempted:0001",
            event_type="attempted",
            occurred_at=now,
            evidence={"operation": "submit-answer"},
        ),
    ):
        accepted = client.post(
            "/api/learning-evidence/events",
            headers=_auth(scope["student"]["token"]),
            json=payload,
        )
        assert accepted.status_code == 201, accepted.json()
    authoritative_matrix = client.get(
        (
            f"/api/progress/courses/{scope['course_id']}/classes/"
            f"{scope['class_id']}/students"
        ),
        headers=_auth(scope["teacher"]["token"]),
    )
    authoritative_student = next(
        row
        for row in authoritative_matrix.json()["items"]
        if row["student_id"] == scope["student"]["id"]
    )
    assert next(
        block
        for block in authoritative_student["blocks"]
        if block["course_unit_id"] == scope["unit_one"]["id"]
    )["completed"] is True
    authoritative_progress = client.get(
        f"/api/progress/me?class_id={scope['class_id']}",
        headers=_auth(scope["student"]["token"]),
    )
    assert authoritative_progress.json()["completed_events"] == 1
    assert authoritative_progress.json()["completion_percent"] == 50.0
    authoritative_aggregate = client.get(
        (
            f"/api/learning-evidence/classes/{scope['class_id']}/courses/"
            f"{scope['course_id']}/aggregate"
        ),
        headers=_auth(scope["teacher"]["token"]),
    )
    assert authoritative_aggregate.json()["activities"][0]["completed"] == 1
    with get_session_factory(get_settings().database_url)() as db:
        entitlement = db.scalar(
            select(LegacyAccessEntitlement).where(
                LegacyAccessEntitlement.subject_user_id == scope["student"]["id"],
                LegacyAccessEntitlement.class_id == scope["class_id"],
                LegacyAccessEntitlement.prerequisite_unit_id == scope["unit_one"]["id"],
            )
        )
        assert entitlement is not None
        assert entitlement.source_event_kind == "legacy_complete"
        assert entitlement.migration_revision == "20260727_0051"
        assert (
            db.scalar(
                select(text("count(*)")).select_from(LegacyAccessEntitlement)
            )
            == 1
        )


def test_progress_denominator_uses_visible_current_rule_scope_across_classes(client):
    scope = _learning_scope(client, "progress-denominator")
    rule = _create_rule(client, scope)
    _activate_rule(client, scope, rule)
    zero = client.get(
        f"/api/progress/me?class_id={scope['class_id']}",
        headers=_auth(scope["student"]["token"]),
    )
    assert zero.status_code == 200, zero.json()
    assert zero.json()["completed_events"] == 0
    assert zero.json()["completion_percent"] == 0.0

    now = datetime.now(UTC)
    for payload in (
        _event_payload(
            scope,
            client_event_id="progress-denominator:started:0001",
            event_type="started",
            occurred_at=now - timedelta(seconds=1),
        ),
        _event_payload(
            scope,
            client_event_id="progress-denominator:attempted:0001",
            event_type="attempted",
            occurred_at=now,
            evidence={"operation": "submit-answer"},
        ),
    ):
        assert client.post(
            "/api/learning-evidence/events",
            headers=_auth(scope["student"]["token"]),
            json=payload,
        ).status_code == 201
    one_of_two = client.get(
        f"/api/progress/me?class_id={scope['class_id']}",
        headers=_auth(scope["student"]["token"]),
    )
    assert one_of_two.json()["completed_events"] == 1
    assert one_of_two.json()["completion_percent"] == 50.0

    locked = client.patch(
        (
            f"/api/courses/{scope['course_id']}/classes/"
            f"{scope['class_id']}/release-plan"
        ),
        headers=_auth(scope["teacher"]["token"]),
        json={
            "expected_version": 1,
            "items": [
                {
                    "course_unit_id": scope["unit_two"]["id"],
                    "release_mode": "locked",
                }
            ],
        },
    )
    assert locked.status_code == 200
    locked_still_counts = client.get(
        f"/api/progress/me?class_id={scope['class_id']}",
        headers=_auth(scope["student"]["token"]),
    )
    assert locked_still_counts.json()["completion_percent"] == 50.0

    hidden = client.patch(
        (
            f"/api/courses/{scope['course_id']}/classes/"
            f"{scope['class_id']}/release-plan"
        ),
        headers=_auth(scope["teacher"]["token"]),
        json={
            "expected_version": 2,
            "items": [
                {
                    "course_unit_id": scope["unit_two"]["id"],
                    "release_mode": "hidden",
                }
            ],
        },
    )
    assert hidden.status_code == 200
    hidden_excluded = client.get(
        f"/api/progress/me?class_id={scope['class_id']}",
        headers=_auth(scope["student"]["token"]),
    )
    assert hidden_excluded.json()["completion_percent"] == 100.0

    second_scope = _learning_scope(client, "progress-denominator-second")
    joined = client.post(
        f"/api/classes/{second_scope['class_id']}/join",
        headers=_auth(scope["student"]["token"]),
        json={"role": "student"},
    )
    assert joined.status_code == 201, joined.json()
    second_rule = _create_rule(client, second_scope)
    _activate_rule(client, second_scope, second_rule)
    cross_scope = client.get(
        "/api/progress/me",
        headers=_auth(scope["student"]["token"]),
    )
    assert cross_scope.status_code == 200, cross_scope.json()
    assert cross_scope.json()["completed_events"] == 1
    assert cross_scope.json()["completion_percent"] == 33.33


def test_authoritative_completion_unlocks_prerequisite_without_legacy_event_join(client):
    scope = _learning_scope(client, "prerequisite")
    plan = client.patch(
        f"/api/courses/{scope['course_id']}/classes/{scope['class_id']}/release-plan",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "expected_version": 1,
            "items": [
                {
                    "course_unit_id": scope["unit_two"]["id"],
                    "prerequisite_unit_id": scope["unit_one"]["id"],
                }
            ],
        },
    )
    assert plan.status_code == 200
    rule = _create_rule(client, scope)
    _activate_rule(client, scope, rule, expected_plan_version=2)
    assignment = client.post(
        f"/api/courses/{scope['course_id']}/units/{scope['unit_two']['id']}/assignments",
        headers=_auth(scope["teacher"]["token"]),
        json={"title": "Authoritative prerequisite assignment"},
    )
    assert assignment.status_code == 201
    before = client.get(
        f"/api/assignments/me?class_id={scope['class_id']}",
        headers=_auth(scope["student"]["token"]),
    )
    assert before.status_code == 200
    target_before = next(
        item
        for item in before.json()["items"]
        if item["assignment"]["id"] == assignment.json()["id"]
    )
    assert target_before["can_submit"] is False
    assert target_before["submit_block_reason"] == "unit_locked"

    now = datetime.now(UTC)
    assert client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=_event_payload(
            scope,
            client_event_id="prerequisite:started:0001",
            event_type="started",
            occurred_at=now - timedelta(seconds=1),
        ),
    ).status_code == 201
    assert client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=_event_payload(
            scope,
            client_event_id="prerequisite:attempted:0001",
            event_type="attempted",
            occurred_at=now,
            evidence={"operation": "submit-answer", "reported_correct": True},
        ),
    ).status_code == 201
    after = client.get(
        f"/api/assignments/me?class_id={scope['class_id']}",
        headers=_auth(scope["student"]["token"]),
    )
    assert after.status_code == 200
    target_after = next(
        item
        for item in after.json()["items"]
        if item["assignment"]["id"] == assignment.json()["id"]
    )
    assert target_after["can_submit"] is True
    assert target_after["submit_block_reason"] is None
    with get_session_factory(get_settings().database_url)() as db:
        assert db.scalar(
            select(text("count(*)"))
            .select_from(LearningEvent)
            .where(
                LearningEvent.user_id == scope["student"]["id"],
                LearningEvent.event_type == "complete",
            )
        ) == 0
        assert db.scalar(
            select(text("count(*)")).select_from(LegacyAccessEntitlement)
        ) == 0


def test_activity_scope_is_bound_to_stable_course_unit_identity(client):
    course_unit_constraint = next(
        constraint
        for constraint in CourseUnit.__table__.constraints
        if constraint.name == "uq_course_units_course_activity_key"
    )
    assert tuple(column.name for column in course_unit_constraint.columns) == (
        "course_id",
        "activity_key",
    )
    projection_constraint = next(
        constraint
        for constraint in LearningActivityProjection.__table__.constraints
        if constraint.name == "uq_le_activity_projection_scope"
    )
    assert tuple(column.name for column in projection_constraint.columns) == (
        "subject_user_id",
        "class_id",
        "course_id",
        "course_unit_id",
        "rule_id",
    )

    scope = _learning_scope(client, "activity-identity")
    rule = _create_rule(client, scope)
    _activate_rule(client, scope, rule)
    mismatched = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json={
            **_event_payload(
                scope,
                client_event_id="activity-identity:mismatch:0001",
                event_type="started",
                occurred_at=datetime.now(UTC),
            ),
            "activity_key": scope["unit_two"]["activity_key"],
        },
    )
    assert mismatched.status_code == 422
    assert mismatched.json()["detail"]["code"] == "activity_key_mismatch"
    with get_session_factory(get_settings().database_url)() as db:
        assert db.scalar(
            select(text("count(*)"))
            .select_from(LearningEvidenceEvent)
            .where(
                LearningEvidenceEvent.client_event_id
                == "activity-identity:mismatch:0001"
            )
        ) == 0


def test_access_query_boundary_and_mysql_current_read_statements_are_explicit():
    backend_root = Path(__file__).resolve().parents[1]
    course_release_source = (
        backend_root / "app/services/course_release_plans.py"
    ).read_text(encoding="utf-8")
    submissions_source = (
        backend_root / "app/api/endpoints/submissions.py"
    ).read_text(encoding="utf-8")
    access_source = (
        backend_root / "app/services/learning_evidence_access.py"
    ).read_text(encoding="utf-8")
    assert "from app.services.learning_evidence import" not in course_release_source
    assert "from app.services.learning_evidence import" not in submissions_source
    assert "course_release_plans" not in access_source
    assert "services.learning_evidence import" not in access_source

    projection_scope = ActivityProjectionScope(
        subject_user_id=1,
        school_id=1,
        class_id=1,
        course_id=1,
        course_unit_id=1,
        activity_key="evidence.current-read",
        rule_id=1,
        rule_version=1,
    )
    binding = LearningRuleClassBinding(
        id=1,
        course_class_id=1,
        plan_version=1,
        rule_id=1,
        rule_version=1,
        created_by_user_id=1,
    )
    statements = [
        learning_evidence_access.effective_rule_binding_statement(
            1,
            1,
            locking_read=True,
        ),
        course_release_write_gate.active_student_membership_statement(
            1,
            1,
            locking_read=True,
        ),
        assignment_policies.assignment_class_policy_statement(
            1,
            1,
            locking_read=True,
        ),
        learning_evidence_service._bound_rule_statement(
            binding,
            course_id=1,
            locking_read=True,
        ),
        learning_evidence_projection._scope_events_statement(
            projection_scope,
            locking_read=True,
        ),
        learning_evidence_projection._activity_projection_statement(
            projection_scope,
            locking_read=True,
        ),
        learning_evidence_projection._resume_events_statement(
            projection_scope,
            locking_read=True,
        ),
        learning_evidence_projection._resume_projection_statement(
            projection_scope,
            locking_read=True,
        ),
    ]
    for statement in statements:
        compiled = str(statement.compile(dialect=mysql.dialect())).upper()
        assert "FOR UPDATE" in compiled


def test_corrupt_redundant_rule_binding_fails_closed_across_reads(client):
    scope = _learning_scope(client, "binding-corrupt")
    rule = _create_rule(client, scope)
    _activate_rule(client, scope, rule)
    with get_session_factory(get_settings().database_url)() as db:
        binding_id = db.scalar(
            select(LearningRuleClassBinding.id).where(
                LearningRuleClassBinding.rule_id == rule["id"]
            )
        )
        assert binding_id is not None
        db.execute(
            text(
                "UPDATE learning_rule_class_bindings "
                "SET rule_version = 999 WHERE id = :binding_id"
            ),
            {"binding_id": binding_id},
        )
        db.commit()
    activation_state = client.get(
        (
            "/api/learning-evidence/rules/activation"
            f"?course_id={scope['course_id']}"
        ),
        headers=_auth(scope["teacher"]["token"]),
    )
    assert activation_state.status_code == 409
    assert activation_state.json()["detail"]["code"] == "rule_binding_invalid"
    same_rule_reactivation = client.post(
        f"/api/learning-evidence/rules/{rule['id']}/activate",
        headers=_auth(scope["teacher"]["token"]),
        json={
            "expected_revision": 1,
            "class_bindings": [
                {
                    "class_id": scope["class_id"],
                    "expected_plan_version": 1,
                }
            ],
        },
    )
    assert same_rule_reactivation.status_code == 409
    assert (
        same_rule_reactivation.json()["detail"]["code"]
        == "rule_binding_invalid"
    )
    recovery = client.get(
        (
            "/api/learning-evidence/me/recovery"
            f"?class_id={scope['class_id']}&course_id={scope['course_id']}"
        ),
        headers=_auth(scope["student"]["token"]),
    )
    assert recovery.status_code == 409
    assert recovery.json()["detail"]["code"] == "rule_binding_invalid"
    access = client.get(
        f"/api/courses/{scope['course_id']}/units?class_id={scope['class_id']}",
        headers=_auth(scope["student"]["token"]),
    )
    assert access.status_code == 409
    progress = client.get(
        f"/api/progress/me?class_id={scope['class_id']}",
        headers=_auth(scope["student"]["token"]),
    )
    assert progress.status_code == 409
    with get_session_factory(get_settings().database_url)() as db:
        corrupted_binding = db.get(LearningRuleClassBinding, binding_id)
        activation = db.scalar(
            select(LearningRuleActivation).where(
                LearningRuleActivation.course_id == scope["course_id"]
            )
        )
        assert corrupted_binding is not None
        assert corrupted_binding.rule_version == 999
        assert activation is not None
        assert activation.revision == 1
        assert (
            db.scalar(
                select(text("count(*)")).select_from(
                    LearningRuleClassBinding
                )
            )
            == 1
        )
        assert (
            db.scalar(
                select(text("count(*)"))
                .select_from(AuditLog)
                .where(
                    AuditLog.action == "learning_evidence.rule.activate"
                )
            )
            == 1
        )


def test_learning_evidence_rows_are_append_only_in_orm(client):
    scope = _learning_scope(client, "append")
    rule = _create_rule(client, scope)
    _activate_rule(client, scope, rule)
    created = client.post(
        "/api/learning-evidence/events",
        headers=_auth(scope["student"]["token"]),
        json=_event_payload(
            scope,
            client_event_id="append-only:started:0001",
            event_type="started",
            occurred_at=datetime.now(UTC),
        ),
    )
    assert created.status_code == 201
    with get_session_factory(get_settings().database_url)() as db:
        event = db.get(LearningEvidenceEvent, created.json()["event_id"])
        assert event is not None
        event.evidence_json = {"mutated": True}
        with pytest.raises(ValueError, match="append-only"):
            db.commit()
        db.rollback()
    with get_session_factory(get_settings().database_url)() as db:
        persisted = db.get(LearningEvidenceEvent, created.json()["event_id"])
        assert persisted.evidence_json == {}


def test_0051_sqlite_upgrade_downgrade_reupgrade_and_mysql_compile(tmp_path, monkeypatch):
    database_path = tmp_path / "learning-evidence-roundtrip.db"
    database_url = f"sqlite+pysqlite:///{database_path.as_posix()}"
    backend_root = Path(__file__).resolve().parents[1]
    monkeypatch.setenv("ASTRA_DATABASE_URL", database_url)
    get_settings.cache_clear()
    reset_database_state()
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "alembic"))
    try:
        command.upgrade(config, "20260719_0050")
        engine = create_engine(database_url)
        now = datetime.now(UTC).isoformat()
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO users "
                    "(id, username, normalized_username, display_name, password_hash, role, status, created_at, updated_at) "
                    "VALUES (1, 'legacy_student', 'legacy_student', 'Legacy student', 'hash', 'student', 'active', :now, :now)"
                ),
                {"now": now},
            )
            connection.execute(
                text(
                    "INSERT INTO schools (id, name, status, version, created_at, updated_at) "
                    "VALUES (1, 'Legacy Evidence School', 'active', 1, :now, :now)"
                ),
                {"now": now},
            )
            connection.execute(
                text(
                    "INSERT INTO class_groups "
                    "(id, school_id, name, status, version, created_at, updated_at) "
                    "VALUES (1, 1, 'Legacy Evidence Class', 'active', 1, :now, :now)"
                ),
                {"now": now},
            )
            connection.execute(
                text(
                    "INSERT INTO courses "
                    "(id, school_id, creator_user_id, galaxy_key, course_key, title, status, created_at, updated_at) "
                    "VALUES (1, 1, 1, 'englab', 'legacy-evidence', 'Legacy Evidence', 'published', :now, :now)"
                ),
                {"now": now},
            )
            connection.execute(
                text(
                    "INSERT INTO course_units "
                    "(id, course_id, activity_key, title, position, status, created_at, updated_at) "
                    "VALUES (1, 1, 'legacy.evidence', 'Legacy Evidence Unit', 1, 'published', :now, :now)"
                ),
                {"now": now},
            )
            connection.execute(
                text(
                    "INSERT INTO course_classes "
                    "(id, course_id, class_id, status, plan_version, created_at, updated_at) "
                    "VALUES (1, 1, 1, 'active', 1, :now, :now)"
                ),
                {"now": now},
            )
            connection.execute(
                text(
                    "INSERT INTO learning_events "
                    "(id, user_id, school_id, class_id, course_id, unit_id, event_type, payload, occurred_at, created_at, updated_at) "
                    "VALUES (:id, 1, 1, 1, 1, 1, 'complete', '{}', :now, :now, :now)"
                ),
                [
                    {"id": event_id, "now": now}
                    for event_id in range(1, 2_002)
                ],
            )
        command.upgrade(config, "20260727_0051")
        names = set(inspect(engine).get_table_names())
        assert {
            "learning_completion_rules",
            "learning_rule_activations",
            "learning_rule_class_bindings",
            "learning_evidence_events",
            "learning_activity_projections",
            "learning_resume_projections",
            "legacy_access_entitlements",
        } <= names
        with engine.connect() as connection:
            entitlement = connection.execute(
                text(
                    "SELECT subject_user_id, class_id, prerequisite_unit_id, "
                    "source_learning_event_id, migration_revision "
                    "FROM legacy_access_entitlements "
                    "WHERE source_learning_event_id = 1"
                )
            ).one()
            assert entitlement == (1, 1, 1, 1, "20260727_0051")
            assert connection.execute(
                text("SELECT COUNT(*) FROM legacy_access_entitlements")
            ).scalar_one() == 2_001
            assert connection.execute(
                text("SELECT COUNT(*) FROM learning_evidence_events")
            ).scalar_one() == 0
        assert ScriptDirectory.from_config(config).get_heads() == ["20260727_0051"]
        command.downgrade(config, "20260719_0050")
        names = set(inspect(engine).get_table_names())
        assert "learning_evidence_events" not in names
        assert "legacy_access_entitlements" not in names
        command.upgrade(config, "20260727_0051")
        with engine.connect() as connection:
            assert connection.execute(
                text("SELECT COUNT(*) FROM legacy_access_entitlements")
            ).scalar_one() == 2_001
    finally:
        reset_database_state()
        get_settings.cache_clear()

    from app.models import (
        LearningActivityProjection,
        LearningCompletionRule,
        LearningEvidenceEvent,
        LearningResumeProjection,
        LearningRuleActivation,
        LearningRuleClassBinding,
    )

    revision_script = ScriptDirectory.from_config(config).get_revision(
        "20260727_0051"
    )
    assert revision_script is not None
    assert (
        str(
            revision_script.module._timestamp_type("mysql").compile(
                dialect=mysql.dialect()
            )
        )
        == "DATETIME(6)"
    )
    migration_client_key = str(
        revision_script.module._client_event_id_type("mysql").compile(
            dialect=mysql.dialect()
        )
    )
    assert "CHARACTER SET ascii" in migration_client_key
    assert "COLLATE ascii_bin" in migration_client_key
    migration_source = (
        backend_root / "alembic/versions/20260727_0051_learning_evidence.py"
    ).read_text(encoding="utf-8")
    assert "AND id > :last_id" in migration_source
    assert "LIMIT :batch_size" in migration_source
    assert "fetchmany" not in migration_source

    for table in (
        LearningCompletionRule.__table__,
        LearningRuleActivation.__table__,
        LearningRuleClassBinding.__table__,
        LearningEvidenceEvent.__table__,
        LearningActivityProjection.__table__,
        LearningResumeProjection.__table__,
        LegacyAccessEntitlement.__table__,
    ):
        ddl = str(CreateTable(table).compile(dialect=mysql.dialect()))
        assert table.name in ddl
        assert "FOREIGN KEY" in ddl
        if table is LearningEvidenceEvent.__table__:
            assert "DATETIME(6)" in ddl
            assert "COLLATE ascii_bin" in ddl
            assert "event_schema_version" in ddl
            assert "event_schema_version > 0" in ddl
            assert "ck_le_events_occurred_at_mysql_range" in ddl
            assert "occurred_at >= '1000-01-01 00:00:00'" in ddl
    for model in (
        LearningRuleActivation,
        LearningActivityProjection,
        LearningResumeProjection,
    ):
        for column_name in ("created_at", "updated_at"):
            compiled_type = str(
                model.__table__.c[column_name].type.compile(
                    dialect=mysql.dialect()
                )
            )
            assert compiled_type == "DATETIME(6)"
    event_index = next(
        index
        for index in LearningEvidenceEvent.__table__.indexes
        if index.name == "ix_le_events_subject_scope_order"
    )
    assert "occurred_at" in str(CreateIndex(event_index).compile(dialect=mysql.dialect()))


@pytest.mark.mysql_release_evidence
def test_0051_mysql_schema_when_explicit_release_drill_is_configured(monkeypatch):
    database_url = os.environ.get("ASTRA_TEST_MYSQL_URL", "").strip()
    expected_database = os.environ.get("ASTRA_TEST_MYSQL_DATABASE", "").strip()
    if not database_url or not expected_database:
        pytest.skip(
            "set ASTRA_TEST_MYSQL_URL and ASTRA_TEST_MYSQL_DATABASE for the explicit MySQL release drill"
        )
    engine = make_engine(database_url)
    try:
        assert engine.dialect.name == "mysql"
        assert engine.url.database == expected_database
        tables = set(inspect(engine).get_table_names())
        assert {
            "learning_completion_rules",
            "learning_evidence_events",
            "learning_activity_projections",
            "legacy_access_entitlements",
        } <= tables
        inspected_event_columns = inspect(engine).get_columns(
            "learning_evidence_events"
        )
        event_columns = {column["name"] for column in inspected_event_columns}
        assert {
            "client_event_id",
            "request_sha256",
            "actor_user_id",
            "subject_user_id",
            "event_schema_version",
            "received_at",
            "corrects_event_id",
        } <= event_columns
        client_event_column = next(
            column
            for column in inspected_event_columns
            if column["name"] == "client_event_id"
        )
        assert getattr(client_event_column["type"], "collation", None) == "ascii_bin"
        occurred_at_column = next(
            column
            for column in inspected_event_columns
            if column["name"] == "occurred_at"
        )
        assert getattr(occurred_at_column["type"], "fsp", None) == 6
        event_checks = {
            constraint["name"]
            for constraint in inspect(engine).get_check_constraints(
                "learning_evidence_events"
            )
        }
        assert "ck_le_events_occurred_at_mysql_range" in event_checks
        event_indexes = {
            index["name"]
            for index in inspect(engine).get_indexes("learning_evidence_events")
        }
        assert "ix_le_events_subject_scope_order" in event_indexes
        projection_columns = {
            column["name"]
            for column in inspect(engine).get_columns(
                "learning_activity_projections"
            )
        }
        assert "reported_correct_attempt_count" in projection_columns

        monkeypatch.setenv("ASTRA_DATABASE_URL", database_url)
        monkeypatch.setenv("ASTRA_AUTO_CREATE_TABLES", "false")
        get_settings.cache_clear()
        reset_database_state()
        unique = uuid4().hex[:12]
        try:
            with TestClient(create_app()) as mysql_client:
                scope = _learning_scope(mysql_client, f"mysql-{unique}")
                first_rule = _create_rule(mysql_client, scope)
                _activate_rule(mysql_client, scope, first_rule)
                now = datetime.now(UTC)
                exact_command = LearnerEvidenceEventCreate.model_validate(
                    _event_payload(
                        scope,
                        client_event_id=f"mysql:{unique}:exact-replay",
                        event_type="predicted",
                        occurred_at=now,
                        evidence={"prediction": "mysql-current-read"},
                    )
                )
                with get_session_factory(database_url)() as db:
                    detached_student = db.get(User, scope["student"]["id"])
                    detached_teacher = db.get(User, scope["teacher"]["id"])
                    assert detached_student is not None
                    assert detached_teacher is not None
                    db.expunge(detached_student)
                    db.expunge(detached_teacher)
                exact_barrier = Barrier(2)

                def append_exact():
                    exact_barrier.wait(timeout=10)
                    with get_session_factory(database_url)() as db:
                        return append_learner_event(
                            db,
                            actor=detached_student,
                            payload=exact_command,
                        )

                with ThreadPoolExecutor(max_workers=2) as pool:
                    exact_receipts = [
                        future.result(timeout=30)
                        for future in (
                            pool.submit(append_exact),
                            pool.submit(append_exact),
                        )
                    ]
                assert sorted(
                    receipt["outcome"] for receipt in exact_receipts
                ) == ["accepted", "duplicate"]
                assert len(
                    {receipt["event_id"] for receipt in exact_receipts}
                ) == 1
                with get_session_factory(database_url)() as db:
                    with pytest.raises(LearningEvidenceError) as key_conflict:
                        append_learner_event(
                            db,
                            actor=detached_student,
                            payload=LearnerEvidenceEventCreate.model_validate(
                                {
                                    **_event_payload(
                                        scope,
                                        client_event_id=(
                                            f"mysql:{unique}:exact-replay"
                                        ),
                                        event_type="predicted",
                                        occurred_at=now,
                                        evidence={"prediction": "different"},
                                    )
                                }
                            ),
                        )
                    assert key_conflict.value.code == "idempotency_payload_conflict"

                source_event_id = exact_receipts[0]["event_id"]
                correction_barrier = Barrier(2)

                def correct_once(index: int):
                    correction_barrier.wait(timeout=10)
                    with get_session_factory(database_url)() as db:
                        try:
                            return (
                                "accepted",
                                append_teacher_correction(
                                    db,
                                    actor=detached_teacher,
                                    target_event_id=source_event_id,
                                    payload=TeacherEvidenceCorrectionCreate(
                                        client_event_id=(
                                            f"mysql:{unique}:correction:{index}"
                                        ),
                                        reason=f"Concurrent correction {index}",
                                        occurred_at=now
                                        + timedelta(seconds=index + 1),
                                    ),
                                ),
                            )
                        except LearningEvidenceError as exc:
                            db.rollback()
                            return ("rejected", (exc.status_code, exc.code))

                with ThreadPoolExecutor(max_workers=2) as pool:
                    correction_results = [
                        future.result(timeout=30)
                        for future in (
                            pool.submit(correct_once, 1),
                            pool.submit(correct_once, 2),
                        )
                    ]
                assert sorted(result[0] for result in correction_results) == [
                    "accepted",
                    "rejected",
                ]
                assert [
                    result[1]
                    for result in correction_results
                    if result[0] == "rejected"
                ] == [(409, "event_already_corrected")]

                distinct_commands = [
                    LearnerEvidenceEventCreate.model_validate(
                        _event_payload(
                            scope,
                            client_event_id=f"mysql:{unique}:started",
                            event_type="started",
                            occurred_at=now + timedelta(seconds=10),
                            evidence={"cursor": {"step": 1}},
                        )
                    ),
                    LearnerEvidenceEventCreate.model_validate(
                        _event_payload(
                            scope,
                            client_event_id=f"mysql:{unique}:attempted",
                            event_type="attempted",
                            occurred_at=now + timedelta(seconds=11),
                            evidence={
                                "operation": "submit-answer",
                                "cursor": {"step": 2},
                            },
                        )
                    ),
                ]
                with get_session_factory(database_url)() as db:
                    detached_other = db.get(User, scope["other_student"]["id"])
                    assert detached_other is not None
                    db.expunge(detached_other)
                distinct_barrier = Barrier(2)

                def append_distinct(command):
                    distinct_barrier.wait(timeout=10)
                    with get_session_factory(database_url)() as db:
                        return append_learner_event(
                            db,
                            actor=detached_other,
                            payload=command,
                        )

                with ThreadPoolExecutor(max_workers=2) as pool:
                    distinct_receipts = [
                        future.result(timeout=30)
                        for future in (
                            pool.submit(append_distinct, distinct_commands[0]),
                            pool.submit(append_distinct, distinct_commands[1]),
                        )
                    ]
                assert {
                    receipt["outcome"] for receipt in distinct_receipts
                } == {"accepted"}
                with get_session_factory(database_url)() as db:
                    projection = db.scalar(
                        select(LearningActivityProjection).where(
                            LearningActivityProjection.subject_user_id
                            == scope["other_student"]["id"],
                            LearningActivityProjection.course_unit_id
                            == scope["unit_one"]["id"],
                            LearningActivityProjection.rule_id
                            == first_rule["id"],
                        )
                    )
                    assert projection is not None
                    assert projection.status == "completed"
                    assert projection.learner_event_count == 2
                    assert (
                        db.scalar(
                            select(text("count(*)"))
                            .select_from(LearningEvidenceEvent)
                            .where(
                                LearningEvidenceEvent.subject_user_id
                                == scope["other_student"]["id"],
                                LearningEvidenceEvent.producer_type == "rule",
                            )
                        )
                        == 1
                    )

                release_change = mysql_client.patch(
                    (
                        f"/api/courses/{scope['course_id']}/classes/"
                        f"{scope['class_id']}/release-plan"
                    ),
                    headers=_auth(scope["teacher"]["token"]),
                    json={
                        "expected_version": 1,
                        "items": [
                            {
                                "course_unit_id": scope["unit_two"]["id"],
                                "release_mode": "locked",
                            }
                        ],
                    },
                )
                assert release_change.status_code == 200
                second_rule = _create_rule(mysql_client, scope)
                activation_command = CompletionRuleActivate.model_validate(
                    {
                        "expected_revision": 1,
                        "class_bindings": [
                            {
                                "class_id": scope["class_id"],
                                "expected_plan_version": 2,
                            }
                        ],
                    }
                )
                old_rule_event = LearnerEvidenceEventCreate.model_validate(
                    _event_payload(
                        scope,
                        client_event_id=f"mysql:{unique}:activation-race",
                        event_type="explained",
                        occurred_at=now + timedelta(seconds=20),
                        evidence={"artifact": "activation race evidence"},
                    )
                )
                activation_barrier = Barrier(2)

                def activate_second():
                    activation_barrier.wait(timeout=10)
                    with get_session_factory(database_url)() as db:
                        return activate_completion_rule(
                            db,
                            actor=detached_teacher,
                            rule_id=second_rule["id"],
                            payload=activation_command,
                        )

                def append_during_activation():
                    activation_barrier.wait(timeout=10)
                    with get_session_factory(database_url)() as db:
                        try:
                            return (
                                "accepted",
                                append_learner_event(
                                    db,
                                    actor=detached_student,
                                    payload=old_rule_event,
                                ),
                            )
                        except LearningEvidenceError as exc:
                            db.rollback()
                            return ("rejected", (exc.status_code, exc.code))

                with ThreadPoolExecutor(max_workers=2) as pool:
                    activation_future = pool.submit(activate_second)
                    event_future = pool.submit(append_during_activation)
                    activated = activation_future.result(timeout=30)
                    raced_event = event_future.result(timeout=30)
                assert activated["revision"] == 2
                if raced_event[0] == "rejected":
                    assert raced_event[1] == (409, "rule_version_conflict")
        finally:
            reset_database_state()
            get_settings.cache_clear()
    finally:
        engine.dispose()
