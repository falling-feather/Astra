#!/usr/bin/env python3
"""QA-019 real FastAPI/SQLite companion probe for engineering.load-path."""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import UTC, datetime, timedelta
import json
import os
from pathlib import Path
import secrets
import shutil
import sys
import tempfile
import traceback
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
TEMP_PREFIX = "astra-qa019-"


def _assert_response(response, status_code: int, label: str) -> dict[str, Any]:
    if response.status_code != status_code:
        try:
            detail = response.json()
        except Exception:  # pragma: no cover - diagnostics only
            detail = response.text
        raise AssertionError(
            f"{label}: expected HTTP {status_code}, got {response.status_code}: {detail}"
        )
    return response.json()


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Cookie": ""}


def _identity(client, suffix: str, role: str) -> dict[str, Any]:
    username = f"qa019_{role}_{suffix}"
    password = f"QA019-{secrets.token_urlsafe(18)}"
    _assert_response(
        client.post(
            "/api/auth/register",
            json={
                "username": username,
                "display_name": f"QA-019 {role}",
                "password": password,
                "role": role,
            },
        ),
        201,
        f"register {role}",
    )
    login = _assert_response(
        client.post("/api/auth/login", json={"username": username, "password": password}),
        200,
        f"login {role}",
    )
    token = login["access_token"]
    me = _assert_response(client.get("/api/users/me", headers=_auth(token)), 200, f"me {role}")
    return {"id": me["id"], "token": token}


def _configure_database(database_path: Path) -> str:
    database_url = f"sqlite+pysqlite:///{database_path.as_posix()}"
    os.environ.update(
        {
            "ASTRA_DATABASE_URL": database_url,
            "ASTRA_AUTO_CREATE_TABLES": "false",
            "ASTRA_ENVIRONMENT": "testing",
            "ASTRA_ADMIN_BOOTSTRAP_ENABLED": "false",
            "ASTRA_AUDIT_IP_HASH_SALT": secrets.token_urlsafe(48),
            "ASTRA_KNOWLEDGE_SNAPSHOT_SCHEDULER_ENABLED": "false",
            "ASTRA_CONTENT_SCRIPT_REMOTE_DRIFT_SCHEDULER_ENABLED": "false",
            "ASTRA_BACKGROUND_TASK_WORKER_ENABLED": "false",
            "ASTRA_ALERT_DELIVERY_ENABLED": "false",
        }
    )
    sys.path.insert(0, str(BACKEND))
    from alembic import command
    from alembic.config import Config

    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "alembic"))
    command.upgrade(config, "head")
    return database_url


def _create_scope(client) -> dict[str, Any]:
    suffix = secrets.token_hex(4)
    teacher = _identity(client, suffix, "teacher")
    student = _identity(client, suffix, "student")
    school = _assert_response(
        client.post(
            "/api/schools",
            headers=_auth(teacher["token"]),
            json={"name": f"QA-019 School {suffix}", "region": "Shanghai"},
        ),
        201,
        "create school",
    )
    class_row = _assert_response(
        client.post(
            "/api/classes",
            headers=_auth(teacher["token"]),
            json={"school_id": school["id"], "name": f"QA-019 Class {suffix}"},
        ),
        201,
        "create class",
    )
    course = _assert_response(
        client.post(
            "/api/courses",
            headers=_auth(teacher["token"]),
            json={
                "school_id": school["id"],
                "galaxy_key": "future-galaxy",
                "course_key": f"engineering-systems-{suffix}",
                "title": "QA-019 Engineering Systems",
                "status": "published",
            },
        ),
        201,
        "create course",
    )
    _assert_response(
        client.post(
            f"/api/courses/{course['id']}/classes",
            headers=_auth(teacher["token"]),
            json={"class_id": class_row["id"]},
        ),
        201,
        "attach class",
    )
    unit = _assert_response(
        client.post(
            f"/api/courses/{course['id']}/units",
            headers=_auth(teacher["token"]),
            json={
                "title": "Load-path controlled investigation",
                "position": 1,
                "activity_key": "engineering.load-path",
                "status": "published",
            },
        ),
        201,
        "create course unit",
    )
    _assert_response(
        client.post(
            f"/api/classes/{class_row['id']}/join",
            headers=_auth(student["token"]),
            json={"role": "student"},
        ),
        201,
        "join student",
    )
    rule = _assert_response(
        client.post(
            "/api/learning-evidence/rules",
            headers=_auth(teacher["token"]),
            json={
                "course_id": course["id"],
                "activities": [
                    {
                        "activity_key": "engineering.load-path",
                        "outcome": "completed",
                        "required_event_types": [
                            "predicted",
                            "attempted",
                            "corrected",
                            "explained",
                        ],
                        "minimum_attempts": 3,
                    }
                ],
            },
        ),
        201,
        "create completion rule",
    )
    activation = _assert_response(
        client.post(
            f"/api/learning-evidence/rules/{rule['id']}/activate",
            headers=_auth(teacher["token"]),
            json={
                "expected_revision": 0,
                "class_bindings": [
                    {"class_id": class_row["id"], "expected_plan_version": 1}
                ],
            },
        ),
        200,
        "activate completion rule",
    )
    activated_version = activation["rule"]["version_number"]
    binding_versions = {binding["rule_version"] for binding in activation["bindings"]}
    if activated_version != rule["version_number"] or binding_versions != {activated_version}:
        raise AssertionError(
            "created rule, activated rule and class binding disagree on rule_version"
        )
    return {
        "teacher": teacher,
        "student": student,
        "class_id": class_row["id"],
        "course_id": course["id"],
        "course_unit_id": unit["id"],
        "activity_key": unit["activity_key"],
        "rule_version": activated_version,
    }


def _payloads(frontend_events: list[dict[str, Any]], scope: dict[str, Any]) -> list[dict[str, Any]]:
    if [event.get("event_type") for event in frontend_events] != [
        "predicted",
        "attempted",
        "attempted",
        "attempted",
        "corrected",
        "explained",
    ]:
        raise AssertionError("frontend event sequence is not the current controlled journey")
    base_time = datetime.now(UTC) - timedelta(seconds=30)
    payloads = []
    for index, event in enumerate(frontend_events):
        payloads.append(
            {
                "client_event_id": event["client_event_id"],
                "class_id": scope["class_id"],
                "course_id": scope["course_id"],
                "course_unit_id": scope["course_unit_id"],
                "activity_key": scope["activity_key"],
                "rule_version": scope["rule_version"],
                "event_type": event["event_type"],
                "evidence": event["evidence"],
                "occurred_at": (base_time + timedelta(milliseconds=index * 100)).isoformat(),
            }
        )
    return payloads


def _run(payload: dict[str, Any], database_path: Path, database_url: str) -> dict[str, Any]:
    from fastapi.responses import JSONResponse
    from fastapi.testclient import TestClient
    from sqlalchemy import func, select, text

    from app.core.config import get_settings
    from app.db.session import get_session_factory, reset_database_state
    from app.main import create_app
    from app.models import LearningActivityProjection, LearningEvidenceEvent

    get_settings.cache_clear()
    reset_database_state()
    session_factory = get_session_factory(database_url)
    with session_factory() as db:
        initially_empty = int(db.scalar(select(func.count()).select_from(LearningEvidenceEvent)) or 0) == 0
        alembic_revision = db.scalar(text("SELECT version_num FROM alembic_version"))

    app = create_app()
    first_failure = {"armed": True, "calls": 0}

    @app.middleware("http")
    async def qa019_one_shot_transport_failure(request, call_next):
        if (
            request.url.path == "/api/learning-evidence/events"
            and request.headers.get("x-qa019-first-transport-failure") == "1"
            and first_failure["armed"]
        ):
            first_failure["armed"] = False
            first_failure["calls"] += 1
            return JSONResponse(
                status_code=503,
                content={
                    "detail": {
                        "code": "qa019_controlled_transport_failure",
                        "message": "one-shot pre-handler failure",
                    }
                },
            )
        return await call_next(request)

    with TestClient(app) as client:
        scope = _create_scope(client)
        if scope["activity_key"] != payload["activity_key"]:
            raise AssertionError("created course unit drifted from engineering.load-path")
        event_payloads = _payloads(payload["frontend_events"], scope)
        predicted = event_payloads[0]

        first = client.post(
            "/api/learning-evidence/events",
            headers={
                **_auth(scope["student"]["token"]),
                "x-qa019-first-transport-failure": "1",
            },
            json=predicted,
        )
        if first.status_code != 503:
            raise AssertionError(f"controlled first transport expected 503, got {first.status_code}")
        with session_factory() as db:
            after_failure_count = int(
                db.scalar(
                    select(func.count())
                    .select_from(LearningEvidenceEvent)
                    .where(LearningEvidenceEvent.client_event_id == predicted["client_event_id"])
                )
                or 0
            )
        if after_failure_count != 0:
            raise AssertionError("one-shot transport failure reached the evidence ledger")

        accepted_response = client.post(
            "/api/learning-evidence/events",
            headers=_auth(scope["student"]["token"]),
            json=predicted,
        )
        accepted = _assert_response(accepted_response, 201, "accept predicted retry")
        duplicate_response = client.post(
            "/api/learning-evidence/events",
            headers=_auth(scope["student"]["token"]),
            json=predicted,
        )
        duplicate = _assert_response(duplicate_response, 200, "duplicate predicted replay")
        if accepted["event_id"] != duplicate["event_id"] or duplicate["outcome"] != "duplicate":
            raise AssertionError("same-ID replay did not return the original event receipt")

        receipts = [accepted]
        for index, event_payload in enumerate(event_payloads[1:], start=1):
            receipts.append(
                _assert_response(
                    client.post(
                        "/api/learning-evidence/events",
                        headers=_auth(scope["student"]["token"]),
                        json=event_payload,
                    ),
                    201,
                    f"append journey event {index}",
                )
            )

        recovery = _assert_response(
            client.get(
                f"/api/learning-evidence/me/recovery?class_id={scope['class_id']}&course_id={scope['course_id']}",
                headers=_auth(scope["student"]["token"]),
            ),
            200,
            "student recovery projection",
        )
        projection_read = next(
            item
            for item in recovery["activities"]
            if item["course_unit_id"] == scope["course_unit_id"]
            and item["activity_key"] == scope["activity_key"]
        )
        teacher_events = _assert_response(
            client.get(
                f"/api/learning-evidence/classes/{scope['class_id']}/courses/{scope['course_id']}/events",
                headers=_auth(scope["teacher"]["token"]),
                params={
                    "subject_user_id": scope["student"]["id"],
                    "activity_key": scope["activity_key"],
                    "limit": 100,
                },
            ),
            200,
            "teacher exact-scope event readback",
        )
        aggregate = _assert_response(
            client.get(
                f"/api/learning-evidence/classes/{scope['class_id']}/courses/{scope['course_id']}/aggregate",
                headers=_auth(scope["teacher"]["token"]),
            ),
            200,
            "teacher exact-scope aggregate",
        )
        aggregate_item = next(
            item
            for item in aggregate["activities"]
            if item["course_unit_id"] == scope["course_unit_id"]
            and item["activity_key"] == scope["activity_key"]
        )

    with session_factory() as db:
        events = list(
            db.scalars(
                select(LearningEvidenceEvent)
                .where(
                    LearningEvidenceEvent.subject_user_id == scope["student"]["id"],
                    LearningEvidenceEvent.class_id == scope["class_id"],
                    LearningEvidenceEvent.course_id == scope["course_id"],
                    LearningEvidenceEvent.course_unit_id == scope["course_unit_id"],
                    LearningEvidenceEvent.activity_key == scope["activity_key"],
                )
                .order_by(LearningEvidenceEvent.id)
            ).all()
        )
        learner_events = [event for event in events if event.producer_type == "learner"]
        rule_events = [event for event in events if event.producer_type == "rule"]
        projection = db.scalar(
            select(LearningActivityProjection).where(
                LearningActivityProjection.subject_user_id == scope["student"]["id"],
                LearningActivityProjection.class_id == scope["class_id"],
                LearningActivityProjection.course_id == scope["course_id"],
                LearningActivityProjection.course_unit_id == scope["course_unit_id"],
                LearningActivityProjection.activity_key == scope["activity_key"],
            )
        )
        duplicate_row_count = int(
            db.scalar(
                select(func.count())
                .select_from(LearningEvidenceEvent)
                .where(LearningEvidenceEvent.client_event_id == predicted["client_event_id"])
            )
            or 0
        )
        foreign_key_violations = [list(row) for row in db.execute(text("PRAGMA foreign_key_check")).all()]

    if projection is None:
        raise AssertionError("service did not create the activity projection")
    event_counts = Counter(event.event_type for event in learner_events)
    expected_counts = Counter({"predicted": 1, "attempted": 3, "corrected": 1, "explained": 1})
    if event_counts != expected_counts:
        raise AssertionError(f"learner ledger counts drifted: {dict(event_counts)}")
    if len(rule_events) != 1 or rule_events[0].event_type != "completed":
        raise AssertionError("completion was not derived exactly once by the rule producer")
    if projection.status != "completed" or projection_read["status"] != "completed":
        raise AssertionError("service-derived completed projection is missing")
    if teacher_events["total"] != 6 or aggregate_item["completed"] != 1:
        raise AssertionError("teacher exact-scope readback disagrees with the ledger")
    if duplicate_row_count != 1 or foreign_key_violations:
        raise AssertionError("SQLite idempotency or foreign-key integrity failed")

    safe_scope = {
        "class_id": scope["class_id"],
        "course_id": scope["course_id"],
        "course_unit_id": scope["course_unit_id"],
        "activity_key": scope["activity_key"],
        "rule_version": scope["rule_version"],
        "subject_user_id": scope["student"]["id"],
    }
    return {
        "status": "PASS",
        "service": {
            "transport": "FastAPI TestClient against create_app()",
            "endpoint": "/api/learning-evidence/events",
            "rule_endpoint": "/api/learning-evidence/rules",
            "teacher_readback_endpoint": "/api/learning-evidence/classes/{class_id}/courses/{course_id}/events",
        },
        "scope": safe_scope,
        "transport_retry": {
            "fixture": "one-shot ASGI middleware returns 503 before the product handler",
            "first_status": first.status_code,
            "row_count_after_failure": after_failure_count,
            "accepted_status": accepted_response.status_code,
            "duplicate_status": duplicate_response.status_code,
            "accepted_outcome": accepted["outcome"],
            "duplicate_outcome": duplicate["outcome"],
            "same_client_event_id": accepted["client_event_id"] == duplicate["client_event_id"],
            "same_event_id": accepted["event_id"] == duplicate["event_id"],
            "row_count": duplicate_row_count,
        },
        "sqlite": {
            "alembic_revision": alembic_revision,
            "learner_event_types": dict(sorted(event_counts.items())),
            "learner_completed_count": sum(
                event.event_type == "completed" for event in learner_events
            ),
            "rule_completed_count": sum(
                event.event_type == "completed" for event in rule_events
            ),
            "projection_status": projection.status,
            "rule_witness": {
                "producer_type": rule_events[0].producer_type,
                "event_type": rule_events[0].event_type,
                "source_event_ids": rule_events[0].source_event_ids_json,
                "learner_receipt_event_ids": [receipt["event_id"] for receipt in receipts],
            },
            "foreign_key_violations": foreign_key_violations,
        },
        "teacher_readback": {
            "exact_class_course": teacher_events["class_id"] == scope["class_id"]
            and teacher_events["course_id"] == scope["course_id"],
            "subject_user_id": teacher_events["subject_user_id"],
            "total": teacher_events["total"],
            "event_types": [item["event_type"] for item in teacher_events["items"]],
            "aggregate_completed": aggregate_item["completed"],
            "aggregate_active_students": aggregate["active_students"],
            "projection_status": projection_read["status"],
        },
        "data_environment": {
            "directory": str(database_path.parent),
            "database": str(database_path),
            "repository_external": ROOT not in database_path.parents,
            "initially_empty_evidence": initially_empty,
            "demo_initializer_called": False,
            "creation": "tempfile.mkdtemp + alembic upgrade head",
            "cleanup": "pending",
        },
    }


def _owned_temp_dir() -> Path:
    directory = Path(tempfile.mkdtemp(prefix=TEMP_PREFIX)).resolve()
    expected_parent = Path(tempfile.gettempdir()).resolve()
    if directory.parent != expected_parent or not directory.name.startswith(TEMP_PREFIX):
        raise RuntimeError(f"refusing unsafe QA-019 temp directory: {directory}")
    if ROOT == directory or ROOT in directory.parents or directory in ROOT.parents:
        raise RuntimeError(f"QA-019 data directory overlaps the repository: {directory}")
    if directory.is_symlink():
        raise RuntimeError(f"QA-019 data directory must not be a symlink: {directory}")
    return directory


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--keep-data", action="store_true")
    args = parser.parse_args()
    owned = _owned_temp_dir()
    database_path = owned / "qa019.sqlite3"
    report: dict[str, Any]
    try:
        payload = json.load(sys.stdin)
        if payload.get("schema") != "astra.qa019.future-current.v1":
            raise ValueError("input schema mismatch")
        if payload.get("task") != "QA-019" or payload.get("activity_key") != "engineering.load-path":
            raise ValueError("input target mismatch")
        database_url = _configure_database(database_path)
        report = _run(payload, database_path, database_url)
        exit_code = 0
    except Exception as exc:  # pragma: no cover - exercised by negative process result
        report = {
            "status": "FAIL",
            "error": {"type": type(exc).__name__, "message": str(exc)},
            "traceback_tail": traceback.format_exc().splitlines()[-12:],
            "data_environment": {
                "directory": str(owned),
                "database": str(database_path),
                "repository_external": ROOT not in database_path.parents,
                "demo_initializer_called": False,
                "cleanup": "pending",
            },
        }
        exit_code = 1
    finally:
        try:
            if str(BACKEND) in sys.path:
                from app.core.config import get_settings
                from app.db.session import reset_database_state

                get_settings.cache_clear()
                reset_database_state()
        except Exception:
            pass
        cleanup = "retained-by-explicit-flag"
        if not args.keep_data:
            expected_parent = Path(tempfile.gettempdir()).resolve()
            resolved = owned.resolve()
            if resolved.parent != expected_parent or not resolved.name.startswith(TEMP_PREFIX):
                cleanup = "refused-unsafe-target"
                exit_code = 1
            else:
                shutil.rmtree(resolved)
                cleanup = "verified-removed" if not resolved.exists() else "remove-failed"
                if cleanup != "verified-removed":
                    exit_code = 1
        report.setdefault("data_environment", {})["cleanup"] = cleanup
    json.dump(report, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
