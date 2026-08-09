from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from statistics import median
from threading import Barrier
from time import perf_counter

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, event, func, inspect, select, text
from sqlalchemy.dialects import mysql
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import aliased
from sqlalchemy.schema import CreateIndex, CreateTable

from app.core.config import get_settings
from app.db.session import get_session_factory, make_engine, reset_database_state
from app.main import create_app
from app.models import (
    ClassMembership,
    CodeJudgeAttempt,
    CodeProblem,
    CodeProblemVersion,
    CodeSubmission,
    Course,
    CourseClass,
    CourseUnit,
    CourseUnitClassPlan,
    SchoolMembership,
    User,
)
from app.services.code_judge import (
    EXPIRED_CLAIM_RECOVERY_BATCH_SIZE,
    TERMINAL_STATUSES,
    CodeRunnerAdapter,
    DisabledCodeRunnerAdapter,
    RunnerAvailability,
    claim_next_code_judge_attempt,
    create_code_submission,
    create_problem_version,
    record_judge_result,
    retry_submission_if_runner_available,
)
from app.services import code_judge as code_judge_service


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Cookie": ""}


def _login(client, username: str, role: str) -> str:
    password = "Code-judge-test-password-123"
    registered = client.post(
        "/api/auth/register",
        json={"username": username, "display_name": username, "password": password, "role": role},
    )
    assert registered.status_code == 201, registered.json()
    logged_in = client.post("/api/auth/login", json={"username": username, "password": password})
    assert logged_in.status_code == 200
    return logged_in.json()["access_token"]


def _school(client, token: str) -> int:
    response = client.post(
        "/api/schools",
        headers=_auth(token),
        json={"name": "Code Judge School", "region": "Shanghai"},
    )
    assert response.status_code == 201, response.json()
    return response.json()["id"]


def _class(client, token: str, school_id: int, name: str) -> int:
    response = client.post("/api/classes", headers=_auth(token), json={"school_id": school_id, "name": name})
    assert response.status_code == 201, response.json()
    return response.json()["id"]


def _course(client, token: str, school_id: int) -> int:
    response = client.post(
        "/api/courses",
        headers=_auth(token),
        json={"school_id": school_id, "title": "Code Judge Course", "status": "published"},
    )
    assert response.status_code == 201, response.json()
    return response.json()["id"]


def _attach(client, token: str, course_id: int, class_id: int) -> None:
    response = client.post(f"/api/courses/{course_id}/classes", headers=_auth(token), json={"class_id": class_id})
    assert response.status_code == 201, response.json()


def _unit(client, token: str, course_id: int) -> int:
    response = client.post(
        f"/api/courses/{course_id}/units",
        headers=_auth(token),
        json={"title": "Code unit", "position": 1, "status": "published", "activity_key": "control-flow.loop-boundary"},
    )
    assert response.status_code == 201, response.json()
    return response.json()["id"]


def _problem_payload(course_id: int, unit_id: int, *, statement: str = "Implement add.") -> dict:
    return {
        "course_id": course_id,
        "course_unit_id": unit_id,
        "title": "Add two integers",
        "statement_markdown": statement,
        "test_cases": [{"stdin": "1 2\\n", "expected_stdout": "3\\n"}],
        "language_allowlist": ["javascript", "python", "c", "cpp"],
        "resource_policy": {
            "cpu_time_ms": 500,
            "wall_time_ms": 1000,
            "memory_kb": 65536,
            "output_max_bytes": 4096,
            "process_limit": 1,
            "network_enabled": False,
            "filesystem_mode": "none",
        },
        "source_max_bytes": 128,
        "input_max_bytes": 16,
        "output_max_bytes": 4096,
    }


def _submission_scope(client, prefix: str) -> tuple[str, str, int, int, int]:
    teacher = _login(client, f"{prefix}_teacher", "teacher")
    student = _login(client, f"{prefix}_student", "student")
    school_id = _school(client, teacher)
    class_id = _class(client, teacher, school_id, f"{prefix} Class")
    course_id = _course(client, teacher, school_id)
    _attach(client, teacher, course_id, class_id)
    unit_id = _unit(client, teacher, course_id)
    joined = client.post(f"/api/classes/{class_id}/join", headers=_auth(student), json={"role": "student"})
    assert joined.status_code == 201, joined.json()
    problem = client.post("/api/code-problems", headers=_auth(teacher), json=_problem_payload(course_id, unit_id))
    assert problem.status_code == 201, problem.json()
    return teacher, student, class_id, course_id, problem.json()["id"]


def test_code_submission_access_idempotency_version_snapshot_and_release_gates(client):
    teacher = _login(client, "code_judge_teacher", "teacher")
    student = _login(client, "code_judge_student", "student")
    other_student = _login(client, "code_judge_student_2", "student")
    school_id = _school(client, teacher)
    class_id = _class(client, teacher, school_id, "Code Judge Class")
    other_class_id = _class(client, teacher, school_id, "Other Code Judge Class")
    course_id = _course(client, teacher, school_id)
    _attach(client, teacher, course_id, class_id)
    unit_id = _unit(client, teacher, course_id)
    assert client.post(f"/api/classes/{class_id}/join", headers=_auth(student), json={"role": "student"}).status_code == 201
    assert client.post(f"/api/classes/{class_id}/join", headers=_auth(other_student), json={"role": "student"}).status_code == 201

    created_problem = client.post("/api/code-problems", headers=_auth(teacher), json=_problem_payload(course_id, unit_id))
    assert created_problem.status_code == 201, created_problem.json()
    problem = created_problem.json()
    assert problem["activity_key"] == "control-flow.loop-boundary"
    assert "test_cases" not in str(problem)
    assert problem["active_version"]["resource_policy"] == {
        "cpu_time_ms": 500,
        "wall_time_ms": 1000,
        "memory_kb": 65536,
        "output_max_bytes": 4096,
        "process_limit": 1,
        "network_enabled": False,
        "filesystem_mode": "none",
    }
    assert client.get(f"/api/code-problems/{problem['id']}", headers=_auth(student)).status_code == 422
    lookup_url = (
        f"/api/code-problems/by-activity?course_id={course_id}"
        "&activity_key=control-flow.loop-boundary"
    )
    assert client.get(lookup_url, headers=_auth(student)).status_code == 422
    student_lookup = client.get(f"{lookup_url}&class_id={class_id}", headers=_auth(student))
    assert student_lookup.status_code == 200
    assert student_lookup.json()["id"] == problem["id"]
    assert "test_cases" not in str(student_lookup.json())
    student_problem = client.get(
        f"/api/code-problems/{problem['id']}?class_id={class_id}", headers=_auth(student)
    )
    assert student_problem.status_code == 200
    assert student_problem.json()["effective_release_state"] == "open"

    payload = {
        "client_submission_id": "contract:submission:0001",
        "class_id": class_id,
        "language": "py",
        "source_code": "print(1 + 2)",
        "stdin": "",
    }
    first = client.post(f"/api/code-problems/{problem['id']}/submissions", headers=_auth(student), json=payload)
    assert first.status_code == 201, first.json()
    submission = first.json()
    assert submission["language"] == "python"
    assert submission["status"] == "runner_unavailable"
    assert submission["result_summary"] == {"runner_state": "runner_disabled"}
    assert "source_code" not in submission
    replay = client.post(f"/api/code-problems/{problem['id']}/submissions", headers=_auth(student), json=payload)
    assert replay.status_code == 200
    assert replay.json()["id"] == submission["id"]
    assert replay.json()["idempotent_replay"] is True
    conflict = client.post(
        f"/api/code-problems/{problem['id']}/submissions",
        headers=_auth(student),
        json={**payload, "source_code": "print(4)"},
    )
    assert conflict.status_code == 409
    oversized = client.post(
        f"/api/code-problems/{problem['id']}/submissions",
        headers=_auth(student),
        json={
            **payload,
            "client_submission_id": "contract:submission:oversized",
            "source_code": "x" * 129,
        },
    )
    assert oversized.status_code == 422
    assert client.get(f"/api/code-submissions/{submission['id']}/source", headers=_auth(other_student)).status_code == 403
    own_source = client.get(f"/api/code-submissions/{submission['id']}/source", headers=_auth(student))
    assert own_source.status_code == 200
    assert own_source.json()["source_code"] == payload["source_code"]
    attempts = client.get(f"/api/code-submissions/{submission['id']}/attempts", headers=_auth(student))
    assert attempts.status_code == 200
    assert attempts.json()[0]["status"] == "runner_unavailable"
    attempts_page = client.get(
        f"/api/code-submissions/{submission['id']}/attempts/page?limit=1&offset=0",
        headers=_auth(student),
    )
    assert attempts_page.status_code == 200
    assert attempts_page.json()["total"] == 1
    assert attempts_page.json()["items"][0]["status"] == "runner_unavailable"
    assert attempts_page.json()["next_offset"] is None
    assert client.get(
        f"/api/code-submissions/{submission['id']}/attempts/page",
        headers=_auth(other_student),
    ).status_code == 403
    teacher_page = client.get(f"/api/code-submissions?class_id={class_id}&course_id={course_id}", headers=_auth(teacher))
    assert teacher_page.status_code == 200
    assert teacher_page.json()["total"] == 1
    assert client.get(f"/api/code-submissions?class_id={other_class_id}", headers=_auth(student)).status_code == 403

    version_payload = _problem_payload(course_id, unit_id, statement="Version two.")
    new_version = client.post(
        f"/api/code-problems/{problem['id']}/versions", headers=_auth(teacher), json={k: v for k, v in version_payload.items() if k not in {"course_id", "course_unit_id", "title"}}
    )
    assert new_version.status_code == 201, new_version.json()
    assert new_version.json()["version_number"] == 2
    with get_session_factory(get_settings().database_url)() as db:
        persisted = db.get(CodeSubmission, submission["id"])
        assert persisted.problem_version_id == problem["active_version"]["id"]
        assert persisted.problem_snapshot_json["statement_markdown"] == "Implement add."
        assert persisted.resource_policy_snapshot_json["network_enabled"] is False

    locked = client.patch(
        f"/api/courses/{course_id}/classes/{class_id}/release-plan",
        headers=_auth(teacher),
        json={"expected_version": 1, "items": [{"course_unit_id": unit_id, "release_mode": "locked"}]},
    )
    assert locked.status_code == 200, locked.json()
    assert client.post(f"/api/code-problems/{problem['id']}/submissions", headers=_auth(student), json=payload).status_code == 409
    assert client.get(f"/api/code-problems/{problem['id']}?class_id={class_id}", headers=_auth(student)).json()["effective_release_state"] == "locked"

    hidden = client.patch(
        f"/api/courses/{course_id}/classes/{class_id}/release-plan",
        headers=_auth(teacher),
        json={"expected_version": 2, "items": [{"course_unit_id": unit_id, "release_mode": "hidden"}]},
    )
    assert hidden.status_code == 200, hidden.json()
    assert client.get(f"/api/code-problems/{problem['id']}?class_id={class_id}", headers=_auth(student)).status_code == 403
    assert client.get(f"/api/code-submissions/{submission['id']}", headers=_auth(student)).status_code == 403
    assert client.get(f"/api/code-submissions?class_id={class_id}", headers=_auth(student)).json()["total"] == 0
    assert client.get(f"/api/code-submissions/{submission['id']}/source", headers=_auth(teacher)).status_code == 200

    reopened = client.patch(
        f"/api/courses/{course_id}/classes/{class_id}/release-plan",
        headers=_auth(teacher),
        json={"expected_version": 3, "items": [{"course_unit_id": unit_id, "release_mode": "open"}]},
    )
    assert reopened.status_code == 200, reopened.json()
    with get_session_factory(get_settings().database_url)() as db:
        course = db.get(Course, course_id)
        assert course is not None
        course.status = "draft"
        db.commit()
    assert client.get(f"/api/code-submissions?class_id={class_id}", headers=_auth(student)).json()["total"] == 0
    assert client.get(f"{lookup_url}&class_id={class_id}", headers=_auth(student)).status_code == 403

    with get_session_factory(get_settings().database_url)() as db:
        audit_count = db.scalar(
            text("SELECT COUNT(*) FROM audit_logs WHERE action IN ('code_problem.create', 'code_submission.create', 'code_submission.idempotent_replay')")
        )
        assert audit_count == 3


def test_code_submission_revision_replay_original_source_and_latest_best_contract(client):
    teacher, student, class_id, course_id, problem_id = _submission_scope(client, "code_revision")
    endpoint = f"/api/code-problems/{problem_id}/submissions"
    original_source = 'label = "e\u0301"\r\nprint(label)\r\n'
    original_stdin = "first\r\nsecond\r\n"
    first_payload = {
        "client_submission_id": "revision:roundtrip:0001",
        "class_id": class_id,
        "language": "python",
        "source_code": original_source,
        "stdin": original_stdin,
    }
    first = client.post(endpoint, headers=_auth(student), json=first_payload)
    assert first.status_code == 201, first.json()
    assert first.json()["client_submission_id"] == first_payload["client_submission_id"]
    assert first.json()["source_sha256"] == sha256(original_source.encode("utf-8")).hexdigest()
    assert first.json()["is_latest_revision"] is True
    assert first.json()["is_best_revision"] is True

    replay = client.post(endpoint, headers=_auth(student), json=first_payload)
    assert replay.status_code == 200, replay.json()
    assert replay.json()["id"] == first.json()["id"]
    assert replay.json()["idempotent_replay"] is True
    canonical_looking_but_distinct = client.post(
        endpoint,
        headers=_auth(student),
        json={**first_payload, "source_code": original_source.replace("e\u0301", "é")},
    )
    assert canonical_looking_but_distinct.status_code == 409

    source = client.get(f"/api/code-submissions/{first.json()['id']}/source", headers=_auth(student))
    assert source.status_code == 200, source.json()
    assert source.json()["source_code"] == original_source
    assert source.json()["stdin"] == original_stdin

    second_payload = {
        **first_payload,
        "client_submission_id": "revision:roundtrip:0002",
        "source_code": "print('second')\r\n",
    }
    second = client.post(endpoint, headers=_auth(student), json=second_payload)
    assert second.status_code == 201, second.json()
    assert second.json()["id"] != first.json()["id"]

    version_payload = _problem_payload(course_id, first.json()["course_unit_id"], statement="Revision version two.")
    version_payload["test_cases"] = [{"stdin": "", "expected_stdout": "3\n"}]
    version_payload["language_allowlist"] = ["c"]
    version_payload["source_max_bytes"] = 1
    version_payload["input_max_bytes"] = 0
    new_version = client.post(
        f"/api/code-problems/{problem_id}/versions",
        headers=_auth(teacher),
        json={
            key: value
            for key, value in version_payload.items()
            if key not in {"course_id", "course_unit_id", "title"}
        },
    )
    assert new_version.status_code == 201, new_version.json()
    cross_version_replay = client.post(endpoint, headers=_auth(student), json=first_payload)
    assert cross_version_replay.status_code == 200, cross_version_replay.json()
    assert cross_version_replay.json()["id"] == first.json()["id"]
    assert cross_version_replay.json()["problem_version_id"] == first.json()["problem_version_id"]
    cross_version_oversized_conflict = client.post(
        endpoint,
        headers=_auth(student),
        json={**first_payload, "source_code": "x" * 129},
    )
    assert cross_version_oversized_conflict.status_code == 409, cross_version_oversized_conflict.json()
    assert (
        cross_version_oversized_conflict.json()["detail"]
        == "Submission idempotency key conflicts with different content"
    )

    with get_session_factory(get_settings().database_url)() as db:
        persisted_first = db.get(CodeSubmission, first.json()["id"])
        persisted_second = db.get(CodeSubmission, second.json()["id"])
        assert persisted_first is not None and persisted_second is not None
        assert persisted_first.source_code.encode("utf-8") == original_source.encode("utf-8")
        assert persisted_first.stdin.encode("utf-8") == original_stdin.encode("utf-8")
        assert persisted_first.client_submission_id == "revision:roundtrip:0001"
        assert persisted_second.client_submission_id == "revision:roundtrip:0002"
        persisted_first.status = "accepted"
        persisted_first.result_summary_json = {"score": 1}
        persisted_first.judged_at = datetime.now(UTC)
        db.commit()

    student_page = client.get(
        f"/api/code-submissions?class_id={class_id}&course_id={course_id}",
        headers=_auth(student),
    )
    assert student_page.status_code == 200, student_page.json()
    assert [item["id"] for item in student_page.json()["items"]] == [second.json()["id"], first.json()["id"]]
    projected = {item["id"]: item for item in student_page.json()["items"]}
    assert projected[second.json()["id"]]["is_latest_revision"] is True
    assert projected[second.json()["id"]]["is_best_revision"] is False
    assert projected[first.json()["id"]]["is_latest_revision"] is False
    assert projected[first.json()["id"]]["is_best_revision"] is True

    teacher_page = client.get(
        f"/api/code-submissions?class_id={class_id}&course_id={course_id}",
        headers=_auth(teacher),
    )
    assert teacher_page.status_code == 200, teacher_page.json()
    assert teacher_page.json()["items"] == student_page.json()["items"]
    for submission_id in (first.json()["id"], second.json()["id"]):
        attempts = client.get(
            f"/api/code-submissions/{submission_id}/attempts/page",
            headers=_auth(student),
        )
        assert attempts.status_code == 200, attempts.json()
        assert attempts.json()["total"] == 1


def test_unique_conflict_savepoint_rereads_winner_and_preserves_conflict_semantics(client, monkeypatch):
    _teacher, student, class_id, _course_id, problem_id = _submission_scope(client, "code_savepoint")
    payload = {
        "client_submission_id": "revision:savepoint:0001",
        "class_id": class_id,
        "language": "python",
        "source_code": "print(3)",
        "stdin": "",
    }
    first = client.post(
        f"/api/code-problems/{problem_id}/submissions",
        headers=_auth(student),
        json=payload,
    )
    assert first.status_code == 201, first.json()

    original_lookup = code_judge_service._idempotent_submission
    lookup_calls = {"count": 0}

    def miss_before_insert(*args, **kwargs):
        lookup_calls["count"] += 1
        if lookup_calls["count"] == 1:
            return None
        return original_lookup(*args, **kwargs)

    monkeypatch.setattr(code_judge_service, "_idempotent_submission", miss_before_insert)
    with get_session_factory(get_settings().database_url)() as db:
        problem = db.get(CodeProblem, problem_id)
        version = db.scalar(
            select(CodeProblemVersion)
            .where(CodeProblemVersion.problem_id == problem_id, CodeProblemVersion.status == "active")
            .order_by(CodeProblemVersion.version_number.desc())
        )
        student_user = db.scalar(select(User).where(User.username == "code_savepoint_student"))
        assert problem is not None and version is not None and student_user is not None
        replay = create_code_submission(
            db,
            problem=problem,
            version=version,
            student_id=student_user.id,
            class_id=class_id,
            client_submission_id=payload["client_submission_id"],
            language=payload["language"],
            source_code=payload["source_code"],
            stdin=payload["stdin"],
            adapter=DisabledCodeRunnerAdapter(),
        )
        assert replay.created is False
        assert replay.idempotent_replay is True
        assert replay.submission.id == first.json()["id"]
        db.commit()

        lookup_calls["count"] = 0
        with pytest.raises(ValueError, match="idempotency_conflict"):
            create_code_submission(
                db,
                problem=problem,
                version=version,
                student_id=student_user.id,
                class_id=class_id,
                client_submission_id=payload["client_submission_id"],
                language=payload["language"],
                source_code="print(4)",
                stdin=payload["stdin"],
                adapter=DisabledCodeRunnerAdapter(),
            )
        db.rollback()

    with get_session_factory(get_settings().database_url)() as db:
        assert db.scalar(
            select(func.count()).select_from(CodeSubmission).where(CodeSubmission.problem_id == problem_id)
        ) == 1
        assert db.scalar(
            select(func.count())
            .select_from(CodeJudgeAttempt)
            .join(CodeSubmission, CodeSubmission.id == CodeJudgeAttempt.submission_id)
            .where(CodeSubmission.problem_id == problem_id)
        ) == 1


def test_concurrent_exact_submission_replay_creates_one_submission_and_attempt(tmp_path, monkeypatch):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'code-double-click.db').as_posix()}"
    monkeypatch.setenv("ASTRA_DATABASE_URL", database_url)
    monkeypatch.setenv("ASTRA_AUTO_CREATE_TABLES", "true")
    get_settings.cache_clear()
    reset_database_state()
    try:
        with TestClient(create_app()) as client:
            _teacher, student, class_id, _course_id, problem_id = _submission_scope(client, "code_double_click")
            endpoint = f"/api/code-problems/{problem_id}/submissions"
            payload = {
                "client_submission_id": "revision:double-click:0001",
                "class_id": class_id,
                "language": "python",
                "source_code": "print(3)",
                "stdin": "",
            }
            barrier = Barrier(2)

            def submit_once():
                barrier.wait(timeout=5)
                return client.post(endpoint, headers=_auth(student), json=payload)

            with ThreadPoolExecutor(max_workers=2) as pool:
                responses = [
                    future.result(timeout=15)
                    for future in (pool.submit(submit_once), pool.submit(submit_once))
                ]

            assert sorted(response.status_code for response in responses) == [200, 201], [
                (response.status_code, response.json()) for response in responses
            ]
            assert len({response.json()["id"] for response in responses}) == 1
            submission_id = responses[0].json()["id"]
            page = client.get(f"/api/code-submissions?class_id={class_id}", headers=_auth(student))
            assert page.status_code == 200, page.json()
            assert page.json()["total"] == 1
            attempts = client.get(f"/api/code-submissions/{submission_id}/attempts/page", headers=_auth(student))
            assert attempts.status_code == 200, attempts.json()
            assert attempts.json()["total"] == 1
    finally:
        reset_database_state()
        get_settings.cache_clear()


class _AvailableAdapter(CodeRunnerAdapter):
    def availability(self) -> RunnerAvailability:
        return RunnerAvailability(available=True, adapter_name="isolated-contract-test")


def test_judge_claim_is_atomic_and_api_has_no_code_execution_path(client):
    teacher = _login(client, "code_claim_teacher", "teacher")
    student = _login(client, "code_claim_student", "student")
    school_id = _school(client, teacher)
    class_id = _class(client, teacher, school_id, "Claim Class")
    course_id = _course(client, teacher, school_id)
    _attach(client, teacher, course_id, class_id)
    unit_id = _unit(client, teacher, course_id)
    assert client.post(f"/api/classes/{class_id}/join", headers=_auth(student), json={"role": "student"}).status_code == 201
    problem_response = client.post("/api/code-problems", headers=_auth(teacher), json=_problem_payload(course_id, unit_id))
    assert problem_response.status_code == 201

    adapter = _AvailableAdapter()
    with get_session_factory(get_settings().database_url)() as db:
        problem_version = db.get(CodeProblemVersion, problem_response.json()["active_version"]["id"])
        problem = db.get(CodeProblem, problem_version.problem_id)
        student_user = db.scalar(select(User).where(User.username == "code_claim_student"))
        teacher_user = db.scalar(select(User).where(User.username == "code_claim_teacher"))
        assert problem is not None and student_user is not None and teacher_user is not None
        # The contract accepts source only as persisted data; the adapter is never invoked by an API route.
        created = create_code_submission(
            db,
            problem=problem,
            version=problem_version,
            student_id=student_user.id,
            class_id=class_id,
            language="python",
            source_code="raise SystemExit('must not run in API')",
            stdin="",
            client_submission_id="service:claim:0001",
            adapter=adapter,
        )
        db.commit()
        assert created.submission.status == "queued"
        lease = claim_next_code_judge_attempt(db, worker_id="worker-a", lease_seconds=30, adapter=adapter)
        assert lease is not None
        assert lease.source_code == "raise SystemExit('must not run in API')"
        assert claim_next_code_judge_attempt(db, worker_id="worker-b", lease_seconds=30, adapter=adapter) is None
        assert record_judge_result(db, lease=lease, status="output_limit", result_summary={"output_bytes": 4097}) is True
        persisted_attempt = db.get(CodeJudgeAttempt, lease.attempt_id)
        assert persisted_attempt.status == "output_limit"
        assert db.get(CodeSubmission, lease.submission_id).status == "output_limit"
        recovery_version = create_problem_version(
            db,
            problem=problem,
            statement_markdown="A recoverable runner test.",
            test_cases=[{"stdin": "", "expected_stdout": "", "weight": 1}],
            language_allowlist=["python"],
            resource_policy={
                "cpu_time_ms": 500,
                "wall_time_ms": 1000,
                "memory_kb": 65536,
                "output_max_bytes": 4096,
                "process_limit": 1,
                "network_enabled": False,
                "filesystem_mode": "none",
            },
            source_max_bytes=128,
            input_max_bytes=16,
            output_max_bytes=4096,
            created_by_user_id=teacher_user.id,
        )
        unavailable = create_code_submission(
            db,
            problem=problem,
            version=recovery_version,
            student_id=student_user.id,
            class_id=class_id,
            language="python",
            source_code="print('recover')",
            stdin="",
            client_submission_id="service:runner-retry:0001",
            adapter=DisabledCodeRunnerAdapter(),
        )
        assert unavailable.submission.status == "runner_unavailable"
        assert retry_submission_if_runner_available(db, submission=unavailable.submission, adapter=adapter) is True
        db.commit()
        retried_attempts = list(
            db.scalars(select(CodeJudgeAttempt).where(CodeJudgeAttempt.submission_id == unavailable.submission.id)).all()
        )
        assert [attempt.status for attempt in retried_attempts] == ["runner_unavailable", "queued"]

    assert {"accepted", "wrong_answer", "partial", "compile_error", "runtime_error", "time_limit", "memory_limit", "output_limit", "internal_error", "cancelled"} <= TERMINAL_STATUSES
    service_source = (Path(__file__).resolve().parents[1] / "app" / "services" / "code_judge.py").read_text(encoding="utf-8")
    api_source = (Path(__file__).resolve().parents[1] / "app" / "api" / "endpoints" / "code_judge.py").read_text(encoding="utf-8")
    forbidden = ("import subprocess", "subprocess.", "import os", "os.system", "eval(", "exec(", "requests.", "httpx.")
    assert not any(token in service_source or token in api_source for token in forbidden)


def test_expired_judge_claim_recovery_is_bounded_stable_and_converges(client, monkeypatch):
    teacher = _login(client, "code_recovery_teacher", "teacher")
    student = _login(client, "code_recovery_student", "student")
    school_id = _school(client, teacher)
    class_id = _class(client, teacher, school_id, "Recovery Class")
    course_id = _course(client, teacher, school_id)
    _attach(client, teacher, course_id, class_id)
    unit_id = _unit(client, teacher, course_id)
    assert client.post(f"/api/classes/{class_id}/join", headers=_auth(student), json={"role": "student"}).status_code == 201
    problem_response = client.post("/api/code-problems", headers=_auth(teacher), json=_problem_payload(course_id, unit_id))
    assert problem_response.status_code == 201

    now = datetime.now(UTC)
    adapter = _AvailableAdapter()
    monkeypatch.setattr(code_judge_service, "EXPIRED_CLAIM_RECOVERY_BATCH_SIZE", 2)
    with get_session_factory(get_settings().database_url)() as db:
        problem = db.get(CodeProblem, problem_response.json()["id"])
        student_user = db.scalar(select(User).where(User.username == "code_recovery_student"))
        teacher_user = db.scalar(select(User).where(User.username == "code_recovery_teacher"))
        assert problem is not None and student_user is not None and teacher_user is not None
        versions = [db.get(CodeProblemVersion, problem_response.json()["active_version"]["id"])]
        assert versions[0] is not None
        for number in range(2, 6):
            versions.append(
                create_problem_version(
                    db,
                    problem=problem,
                    statement_markdown=f"Recovery version {number}.",
                    test_cases=[{"stdin": "", "expected_stdout": "", "weight": 1}],
                    language_allowlist=["python"],
                    resource_policy={
                        "cpu_time_ms": 500,
                        "wall_time_ms": 1000,
                        "memory_kb": 65536,
                        "output_max_bytes": 4096,
                        "process_limit": 1,
                        "network_enabled": False,
                        "filesystem_mode": "none",
                    },
                    source_max_bytes=128,
                    input_max_bytes=16,
                    output_max_bytes=4096,
                    created_by_user_id=teacher_user.id,
                )
            )
        for index, version in enumerate(versions):
            assert version is not None
            created = create_code_submission(
                db,
                problem=problem,
                version=version,
                student_id=student_user.id,
                class_id=class_id,
                language="python",
                source_code=f"print({index})",
                stdin="",
                client_submission_id=f"service:recovery:{index:04d}",
                adapter=adapter,
            )
            created.submission.status = "running"
            attempt = db.scalar(select(CodeJudgeAttempt).where(CodeJudgeAttempt.submission_id == created.submission.id))
            assert attempt is not None
            attempt.status = "running"
            attempt.claim_owner = "expired-worker"
            attempt.claim_token = f"expired-{index}"
            attempt.claim_expires_at = now - timedelta(minutes=5 - index)
        db.commit()

        first = code_judge_service._requeue_expired_claims(db, now)
        db.flush()
        first_recovered = list(
            db.scalars(
                select(CodeJudgeAttempt)
                .where(CodeJudgeAttempt.status == "queued")
                .order_by(CodeJudgeAttempt.available_at, CodeJudgeAttempt.id)
            ).all()
        )
        assert first == 2
        assert [attempt.claim_expires_at for attempt in first_recovered] == [None, None]
        assert len(first_recovered) == 2
        assert db.scalar(
            select(func.count()).select_from(CodeJudgeAttempt).where(CodeJudgeAttempt.status == "running")
        ) == 3
        db.commit()

        second = code_judge_service._requeue_expired_claims(db, now)
        db.commit()
        third = code_judge_service._requeue_expired_claims(db, now)
        db.commit()
        assert (second, third) == (2, 1)
        assert db.scalar(
            select(func.count()).select_from(CodeJudgeAttempt).where(CodeJudgeAttempt.status == "running")
        ) == 0
        assert db.scalar(
            select(func.count()).select_from(CodeJudgeAttempt).where(CodeJudgeAttempt.status == "queued")
        ) == 5

    assert EXPIRED_CLAIM_RECOVERY_BATCH_SIZE == 100


def test_code_submission_list_is_database_paginated(client):
    teacher = _login(client, "code_page_teacher", "teacher")
    student = _login(client, "code_page_student", "student")
    school_id = _school(client, teacher)
    class_id = _class(client, teacher, school_id, "Pagination Class")
    course_id = _course(client, teacher, school_id)
    _attach(client, teacher, course_id, class_id)
    unit_id = _unit(client, teacher, course_id)
    assert client.post(f"/api/classes/{class_id}/join", headers=_auth(student), json={"role": "student"}).status_code == 201
    problem_response = client.post("/api/code-problems", headers=_auth(teacher), json=_problem_payload(course_id, unit_id))
    assert problem_response.status_code == 201
    first = client.post(
        f"/api/code-problems/{problem_response.json()['id']}/submissions",
        headers=_auth(student),
        json={"class_id": class_id, "language": "python", "source_code": "print(3)", "stdin": ""},
    )
    assert first.status_code == 201
    for version_number in range(2, 7):
        version_payload = _problem_payload(course_id, unit_id, statement=f"Pagination version {version_number}.")
        version = client.post(
            f"/api/code-problems/{problem_response.json()['id']}/versions",
            headers=_auth(teacher),
            json={key: value for key, value in version_payload.items() if key not in {"course_id", "course_unit_id", "title"}},
        )
        assert version.status_code == 201
        created = client.post(
            f"/api/code-problems/{problem_response.json()['id']}/submissions",
            headers=_auth(student),
            json={"class_id": class_id, "language": "python", "source_code": f"print({version_number})", "stdin": ""},
        )
        assert created.status_code == 201

    submission_statements: list[str] = []
    engine = make_engine(get_settings().database_url)

    def capture_statement(_connection, _cursor, statement, _parameters, _context, _executemany):
        if "code_submissions" in statement.lower():
            submission_statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture_statement)
    try:
        page = client.get(f"/api/code-submissions?class_id={class_id}&limit=3&offset=0", headers=_auth(student))
    finally:
        event.remove(engine, "before_cursor_execute", capture_statement)
    assert page.status_code == 200
    assert page.json()["total"] == 6
    assert len(page.json()["items"]) == 3
    assert page.json()["next_offset"] == 3
    # The list data path is one count, one limited page, and one projection
    # query for every non-empty page. Authentication/scope reads are separate.
    assert len(submission_statements) == 3
    assert sum(statement.lstrip().upper().startswith("WITH") for statement in submission_statements) == 1


def test_be016_projection_2500_rows_is_fixed_query_global_and_explainable(client):
    teacher, student, class_id, course_id, problem_id = _submission_scope(client, "be016_projection")
    with get_session_factory(get_settings().database_url)() as db:
        problem = db.get(CodeProblem, problem_id)
        version = db.scalar(
            select(CodeProblemVersion)
            .where(CodeProblemVersion.problem_id == problem_id)
            .order_by(CodeProblemVersion.version_number.desc())
        )
        student_user = db.scalar(select(User).where(User.username == "be016_projection_student"))
        assert problem is not None and version is not None and student_user is not None
        school_id = problem.school_id

    second_class_id = _class(client, teacher, school_id, "BE-016 second projection class")
    _attach(client, teacher, course_id, second_class_id)

    statuses = ("accepted", "wrong_answer", "queued", "partial", "runtime_error")
    revision_count = len(statuses)
    student_count = 50
    problem_count = 10
    base_created_at = datetime(2026, 8, 9, tzinfo=UTC)
    empty_sha256 = sha256(b"").hexdigest()
    with get_session_factory(get_settings().database_url)() as db:
        problem = db.get(CodeProblem, problem_id)
        version = db.scalar(
            select(CodeProblemVersion)
            .where(CodeProblemVersion.problem_id == problem_id)
            .order_by(CodeProblemVersion.version_number.desc())
        )
        student_user = db.scalar(select(User).where(User.username == "be016_projection_student"))
        teacher_user = db.scalar(select(User).where(User.username == "be016_projection_teacher"))
        assert problem is not None and version is not None
        assert student_user is not None and teacher_user is not None

        students = [student_user]
        for student_index in range(1, student_count):
            benchmark_student = User(
                username=f"be016_projection_student_{student_index:02d}",
                normalized_username=f"be016_projection_student_{student_index:02d}",
                display_name=f"BE-016 projection student {student_index:02d}",
                password_hash=student_user.password_hash,
                role="student",
                status="active",
            )
            db.add(benchmark_student)
            students.append(benchmark_student)
        db.flush()

        for student_index, benchmark_student in enumerate(students[1:], start=1):
            scope_class_id = class_id if student_index < student_count // 2 else second_class_id
            db.add(
                SchoolMembership(
                    school_id=school_id,
                    user_id=benchmark_student.id,
                    role="student",
                    status="active",
                )
            )
            db.add(
                ClassMembership(
                    class_id=scope_class_id,
                    user_id=benchmark_student.id,
                    role="student",
                    status="active",
                )
            )

        units = [db.get(CourseUnit, problem.course_unit_id)]
        problems = [problem]
        versions = [version]
        assert units[0] is not None
        for problem_index in range(1, problem_count):
            unit = CourseUnit(
                course_id=course_id,
                activity_key=f"be016.problem.{problem_index}",
                title=f"BE-016 problem unit {problem_index}",
                position=problem_index + 1,
                status="published",
            )
            db.add(unit)
            db.flush()
            benchmark_problem = CodeProblem(
                school_id=school_id,
                course_id=course_id,
                course_unit_id=unit.id,
                activity_key=unit.activity_key,
                title=f"BE-016 problem {problem_index}",
                status="active",
                created_by_user_id=teacher_user.id,
            )
            db.add(benchmark_problem)
            db.flush()
            benchmark_version = CodeProblemVersion(
                problem_id=benchmark_problem.id,
                version_number=1,
                status="active",
                statement_markdown=version.statement_markdown,
                test_spec_json=dict(version.test_spec_json),
                language_allowlist_json=list(version.language_allowlist_json),
                resource_policy_json=dict(version.resource_policy_json),
                source_max_bytes=version.source_max_bytes,
                input_max_bytes=version.input_max_bytes,
                output_max_bytes=version.output_max_bytes,
                spec_sha256=version.spec_sha256,
                created_by_user_id=teacher_user.id,
            )
            db.add(benchmark_version)
            units.append(unit)
            problems.append(benchmark_problem)
            versions.append(benchmark_version)
        db.flush()

        course_classes = list(
            db.scalars(
                select(CourseClass).where(
                    CourseClass.course_id == course_id,
                    CourseClass.class_id.in_((class_id, second_class_id)),
                )
            ).all()
        )
        assert len(course_classes) == 2
        for course_class in course_classes:
            planned_unit_ids = set(
                db.scalars(
                    select(CourseUnitClassPlan.course_unit_id).where(
                        CourseUnitClassPlan.course_class_id == course_class.id
                    )
                ).all()
            )
            for position, unit in enumerate(units, start=1):
                if unit.id not in planned_unit_ids:
                    db.add(
                        CourseUnitClassPlan(
                            course_class_id=course_class.id,
                            course_unit_id=unit.id,
                            position=position,
                            release_mode="open",
                        )
                    )
        db.flush()

        student_ids = [benchmark_student.id for benchmark_student in students]
        problem_ids = [benchmark_problem.id for benchmark_problem in problems]
        activity_keys = [benchmark_problem.activity_key for benchmark_problem in problems]
        rows = []
        for student_index, benchmark_student in enumerate(students):
            scope_class_id = class_id if student_index < student_count // 2 else second_class_id
            for problem_index, (benchmark_problem, benchmark_version) in enumerate(
                zip(problems, versions, strict=True)
            ):
                for revision_index, submission_status in enumerate(statuses):
                    source = (
                        f"print({scope_class_id}, {student_index}, {problem_index}, {revision_index})"
                    )
                    scope_index = student_index * problem_count + problem_index
                    created_at = base_created_at + timedelta(
                        seconds=revision_index * student_count * problem_count + scope_index
                    )
                    rows.append(
                        {
                            "school_id": school_id,
                            "course_id": course_id,
                            "class_id": scope_class_id,
                            "course_unit_id": benchmark_problem.course_unit_id,
                            "activity_key": benchmark_problem.activity_key,
                            "problem_id": benchmark_problem.id,
                            "problem_version_id": benchmark_version.id,
                            "student_id": benchmark_student.id,
                            "client_submission_id": (
                                f"be016:{scope_class_id}:{student_index}:{problem_index}:{revision_index}"
                            ),
                            "language": "python",
                            "source_code": source,
                            "stdin": "",
                            "source_sha256": sha256(source.encode("utf-8")).hexdigest(),
                            "input_sha256": empty_sha256,
                            "problem_snapshot_json": {"problem_id": benchmark_problem.id},
                            "resource_policy_snapshot_json": dict(benchmark_version.resource_policy_json),
                            "status": submission_status,
                            # The accepted row deliberately has the lowest score:
                            # status-best must never turn into numeric-score best.
                            "result_summary_json": {
                                "score": 1 if submission_status == "accepted" else 999
                            },
                            "judged_at": created_at if submission_status != "queued" else None,
                            "created_at": created_at,
                            "updated_at": created_at,
                        }
                    )
        assert len(rows) == 2_500
        db.execute(CodeSubmission.__table__.insert(), rows)
        db.commit()
        assert db.execute(text("PRAGMA foreign_key_check")).all() == []

    engine = make_engine(get_settings().database_url)

    def request_with_submission_sql(url: str, token: str = teacher):
        statements: list[str] = []

        def capture_statement(_connection, _cursor, statement, _parameters, _context, _executemany):
            if "code_submissions" in statement.lower():
                statements.append(statement)

        event.listen(engine, "before_cursor_execute", capture_statement)
        try:
            response = client.get(url, headers=_auth(token))
        finally:
            event.remove(engine, "before_cursor_execute", capture_statement)
        return response, statements

    first_page, first_page_sql = request_with_submission_sql(
        f"/api/code-submissions?class_id={class_id}&course_id={course_id}&limit=1&offset=250"
    )
    large_page, large_page_sql = request_with_submission_sql(
        f"/api/code-submissions?class_id={class_id}&course_id={course_id}&limit=200&offset=0"
    )
    empty_page, empty_page_sql = request_with_submission_sql(
        f"/api/code-submissions?class_id={class_id}&course_id={course_id}&limit=200&offset=5000"
    )
    assert first_page.status_code == 200, first_page.json()
    assert large_page.status_code == 200, large_page.json()
    assert empty_page.status_code == 200, empty_page.json()
    assert len(first_page_sql) == len(large_page_sql) == 3
    assert len(empty_page_sql) == 2
    assert not any(statement.lstrip().upper().startswith("WITH") for statement in empty_page_sql)
    assert first_page.json()["total"] == large_page.json()["total"] == 1_250
    assert empty_page.json()["total"] == 1_250
    assert empty_page.json()["items"] == []
    assert empty_page.json()["next_offset"] is None
    assert len(first_page.json()["items"]) == 1
    assert len(large_page.json()["items"]) == 200
    assert large_page.json()["limit"] == 200
    assert large_page.json()["offset"] == 0
    assert large_page.json()["next_offset"] == 200
    # The first 250 rows are the latest revision from every class scope;
    # offset=250 starts the previous revision layer, so both flags are global.
    assert first_page.json()["items"][0]["is_latest_revision"] is False
    assert first_page.json()["items"][0]["is_best_revision"] is False
    assert sum(item["is_latest_revision"] for item in large_page.json()["items"]) == 200
    assert sum(item["is_best_revision"] for item in large_page.json()["items"]) == 0
    assert not any(
        item["is_latest_revision"] and item["is_best_revision"]
        for item in large_page.json()["items"]
    )

    activity_page, activity_page_sql = request_with_submission_sql(
        f"/api/code-submissions?class_id={class_id}&course_id={course_id}"
        f"&activity_key={activity_keys[0]}&limit=200"
    )
    assert activity_page.status_code == 200, activity_page.json()
    assert len(activity_page_sql) == 3
    assert activity_page.json()["total"] == 25 * revision_count
    assert sum(item["is_latest_revision"] for item in activity_page.json()["items"]) == 25
    assert sum(item["is_best_revision"] for item in activity_page.json()["items"]) == 25

    with get_session_factory(get_settings().database_url)() as db:
        expected_ids = list(
            db.scalars(
                select(CodeSubmission.id)
                .where(CodeSubmission.class_id == class_id, CodeSubmission.course_id == course_id)
                .order_by(CodeSubmission.created_at.desc(), CodeSubmission.id.desc())
                .limit(200)
            ).all()
        )
        assert [item["id"] for item in large_page.json()["items"]] == expected_ids

        status_filtered_rows = list(
            db.scalars(
                select(CodeSubmission)
                .where(
                    CodeSubmission.student_id.in_((student_ids[0], student_ids[student_count // 2])),
                    CodeSubmission.problem_id == problem_ids[0],
                    CodeSubmission.class_id.in_((class_id, second_class_id)),
                    CodeSubmission.status == "partial",
                )
                .order_by(CodeSubmission.class_id)
            ).all()
        )
        assert len(status_filtered_rows) == 2
        projections = code_judge_service.submission_projection_ids_for_page(db, status_filtered_rows)
        assert len(projections) == 2
        for filtered_submission in status_filtered_rows:
            scope = (
                filtered_submission.student_id,
                filtered_submission.problem_id,
                filtered_submission.class_id,
            )
            full_scope = list(
                db.scalars(
                    select(CodeSubmission)
                    .where(
                        CodeSubmission.student_id == filtered_submission.student_id,
                        CodeSubmission.problem_id == filtered_submission.problem_id,
                        CodeSubmission.class_id == filtered_submission.class_id,
                    )
                    .order_by(CodeSubmission.created_at.desc(), CodeSubmission.id.desc())
                ).all()
            )
            latest = full_scope[0]
            status_best = next(item for item in full_scope if item.status == "accepted")
            assert latest.status == "runtime_error"
            assert status_best.result_summary_json["score"] < latest.result_summary_json["score"]
            assert projections[scope] == (latest.id, status_best.id)
            assert filtered_submission.id not in projections[scope]

        page_statement = (
            select(CodeSubmission)
            .where(CodeSubmission.class_id == class_id, CodeSubmission.course_id == course_id)
            .order_by(CodeSubmission.created_at.desc(), CodeSubmission.id.desc())
            .limit(200)
        )
        benchmark_page_rows = list(db.scalars(page_statement).all())
        assert len(benchmark_page_rows) == 200
        benchmark_page_scopes = {
            (submission.student_id, submission.problem_id, submission.class_id)
            for submission in benchmark_page_rows
        }
        assert len(benchmark_page_scopes) == 200
        projection_statement = code_judge_service._submission_projection_statement(
            [submission.id for submission in benchmark_page_rows]
        )
        compiled = projection_statement.compile(
            dialect=engine.dialect,
            compile_kwargs={"literal_binds": True},
        )
        explain_rows = db.execute(text(f"EXPLAIN QUERY PLAN {compiled}")).all()
        explain = "\n".join(str(row[-1]) for row in explain_rows)
        assert "page_submission_scopes" in explain
        assert "student_id=? AND problem_id=? AND class_id=?" in explain
        assert "CORRELATED SCALAR SUBQUERY" not in explain
        assert "TEMP B-TREE FOR ORDER BY" not in explain
        assert len(db.execute(projection_statement).all()) == 1_000

        latest_candidate = aliased(CodeSubmission)
        best_candidate = aliased(CodeSubmission)
        old_latest_id = (
            select(latest_candidate.id)
            .where(
                latest_candidate.student_id == CodeSubmission.student_id,
                latest_candidate.problem_id == CodeSubmission.problem_id,
                latest_candidate.class_id == CodeSubmission.class_id,
            )
            .order_by(latest_candidate.created_at.desc(), latest_candidate.id.desc())
            .limit(1)
            .correlate(CodeSubmission)
            .scalar_subquery()
        )
        old_best_id = (
            select(best_candidate.id)
            .where(
                best_candidate.student_id == CodeSubmission.student_id,
                best_candidate.problem_id == CodeSubmission.problem_id,
                best_candidate.class_id == CodeSubmission.class_id,
            )
            .order_by(
                code_judge_service._submission_status_priority(best_candidate.status).desc(),
                best_candidate.created_at.desc(),
                best_candidate.id.desc(),
            )
            .limit(1)
            .correlate(CodeSubmission)
            .scalar_subquery()
        )
        old_list_statement = (
            select(
                CodeSubmission,
                old_latest_id.label("latest_submission_id"),
                old_best_id.label("best_submission_id"),
            )
            .where(CodeSubmission.class_id == class_id, CodeSubmission.course_id == course_id)
            .order_by(CodeSubmission.created_at.desc(), CodeSubmission.id.desc())
            .limit(200)
        )
        dense_page_statement = (
            select(CodeSubmission)
            .where(
                CodeSubmission.class_id == class_id,
                CodeSubmission.course_id == course_id,
                CodeSubmission.student_id.in_(student_ids[:4]),
            )
            .order_by(CodeSubmission.created_at.desc(), CodeSubmission.id.desc())
            .limit(200)
        )
        dense_page_rows = list(db.scalars(dense_page_statement).all())
        assert len(dense_page_rows) == 200
        assert len(
            {
                (submission.student_id, submission.problem_id, submission.class_id)
                for submission in dense_page_rows
            }
        ) == 40
        dense_projection_statement = code_judge_service._submission_projection_statement(
            [submission.id for submission in dense_page_rows]
        )
        assert len(db.execute(dense_projection_statement).all()) == 200
        dense_old_list_statement = (
            select(
                CodeSubmission,
                old_latest_id.label("latest_submission_id"),
                old_best_id.label("best_submission_id"),
            )
            .where(
                CodeSubmission.class_id == class_id,
                CodeSubmission.course_id == course_id,
                CodeSubmission.student_id.in_(student_ids[:4]),
            )
            .order_by(CodeSubmission.created_at.desc(), CodeSubmission.id.desc())
            .limit(200)
        )
        old_compiled = old_list_statement.compile(
            dialect=engine.dialect,
            compile_kwargs={"literal_binds": True},
        )
        old_explain_rows = db.execute(text(f"EXPLAIN QUERY PLAN {old_compiled}")).all()
        old_explain = "\n".join(str(row[-1]) for row in old_explain_rows)
        assert old_explain.count("CORRELATED SCALAR SUBQUERY") == 2

        mysql8 = mysql.dialect()
        mysql8.server_version_info = (8, 0, 36)
        mysql_compiled = str(
            projection_statement.compile(
                dialect=mysql8,
                compile_kwargs={"literal_binds": True},
            )
        ).upper()
        assert "WITH PAGE_SUBMISSION_SCOPES AS" in mysql_compiled
        assert "JOIN PAGE_SUBMISSION_SCOPES" in mysql_compiled
        assert "ROW_NUMBER() OVER" not in mysql_compiled

        def hot_timings(operation, runs: int = 15):
            operation()
            durations = []
            for _ in range(runs):
                started = perf_counter()
                operation()
                durations.append((perf_counter() - started) * 1000)
            return durations

        old_timings = hot_timings(lambda: db.execute(old_list_statement).all())
        new_timings = hot_timings(
            lambda: (
                db.execute(page_statement).all(),
                db.execute(projection_statement).all(),
            )
        )
        dense_old_timings = hot_timings(lambda: db.execute(dense_old_list_statement).all())
        dense_new_timings = hot_timings(
            lambda: (
                db.execute(dense_page_statement).all(),
                db.execute(dense_projection_statement).all(),
            )
        )
        print(
            "BE016_SQLITE_BENCHMARK "
            f"rows={len(rows)} runs=15 page_scopes=200 candidates=1000 "
            f"old_median_ms={median(old_timings):.3f} old_max_ms={max(old_timings):.3f} "
            f"new_median_ms={median(new_timings):.3f} new_max_ms={max(new_timings):.3f} "
            "dense_page_scopes=40 dense_candidates=200 "
            f"dense_old_median_ms={median(dense_old_timings):.3f} "
            f"dense_new_median_ms={median(dense_new_timings):.3f}"
        )

    student_page = client.get(
        f"/api/code-submissions?class_id={class_id}&course_id={course_id}&limit=200",
        headers=_auth(student),
    )
    assert student_page.status_code == 200, student_page.json()
    assert student_page.json()["total"] == problem_count * revision_count
    assert {item["student_id"] for item in student_page.json()["items"]} == {student_ids[0]}
    assert client.get(
        f"/api/code-submissions?class_id={second_class_id}",
        headers=_auth(student),
    ).status_code == 403
    second_class_page = client.get(
        f"/api/code-submissions?class_id={second_class_id}&course_id={course_id}&limit=200",
        headers=_auth(teacher),
    )
    assert second_class_page.status_code == 200, second_class_page.json()
    assert second_class_page.json()["total"] == 1_250

    admin = _login(client, "be016_projection_admin", "teacher")
    with get_session_factory(get_settings().database_url)() as db:
        admin_user = db.scalar(select(User).where(User.username == "be016_projection_admin"))
        assert admin_user is not None
        admin_user.role = "admin"
        db.commit()
    admin_page, admin_page_sql = request_with_submission_sql(
        "/api/code-submissions?limit=200&offset=0",
        token=admin,
    )
    assert admin_page.status_code == 200, admin_page.json()
    assert len(admin_page_sql) == 3
    assert admin_page.json()["total"] == 2_500
    assert len(admin_page.json()["items"]) == 200

    openapi = client.get("/api/openapi.json")
    assert openapi.status_code == 200
    best_description = openapi.json()["components"]["schemas"]["CodeSubmissionRead"]["properties"][
        "is_best_revision"
    ]["description"]
    assert "Status-priority best revision" in best_description
    assert "not the highest numeric score" in best_description


def test_0050_sqlite_roundtrip_reupgrade_and_mysql_schema_compile(tmp_path, monkeypatch):
    database_path = tmp_path / "code-judge-roundtrip.db"
    database_url = f"sqlite+pysqlite:///{database_path.as_posix()}"
    backend_root = Path(__file__).resolve().parents[1]
    monkeypatch.setenv("ASTRA_DATABASE_URL", database_url)
    get_settings.cache_clear()
    reset_database_state()
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "alembic"))
    try:
        command.upgrade(config, "20260716_0047")
        command.upgrade(config, "20260719_0049")
        assert "ix_code_judge_attempts_expired_claim" not in {
            index["name"] for index in inspect(create_engine(database_url)).get_indexes("code_judge_attempts")
        }
        command.upgrade(config, "20260719_0050")
        engine = create_engine(database_url)
        names = set(inspect(engine).get_table_names())
        assert {"code_problems", "code_problem_versions", "code_submissions", "code_judge_attempts"} <= names
        assert "ix_code_judge_attempts_expired_claim" in {
            index["name"] for index in inspect(engine).get_indexes("code_judge_attempts")
        }
        assert ScriptDirectory.from_config(config).get_heads() == ["20260809_0052"]
        command.downgrade(config, "20260719_0049")
        assert "ix_code_judge_attempts_expired_claim" not in {
            index["name"] for index in inspect(engine).get_indexes("code_judge_attempts")
        }
        command.upgrade(config, "20260719_0050")
        assert "ix_code_judge_attempts_expired_claim" in {
            index["name"] for index in inspect(engine).get_indexes("code_judge_attempts")
        }
        command.downgrade(config, "20260716_0047")
        names = set(inspect(engine).get_table_names())
        assert not {"code_problems", "code_problem_versions", "code_submissions", "code_judge_attempts"} & names
    finally:
        reset_database_state()
        get_settings.cache_clear()

    for table in (CodeSubmission.__table__, CodeJudgeAttempt.__table__):
        ddl = str(CreateTable(table).compile(dialect=mysql.dialect()))
        assert "code_" in ddl
        assert "status IN" in ddl
        assert "VARCHAR" in ddl
    recovery_index = next(
        index for index in CodeJudgeAttempt.__table__.indexes if index.name == "ix_code_judge_attempts_expired_claim"
    )
    assert "claim_expires_at" in str(CreateIndex(recovery_index).compile(dialect=mysql.dialect()))


def test_0052_code_revision_migration_preserves_history_and_gates_lossy_downgrade(tmp_path, monkeypatch):
    database_path = tmp_path / "code-revision-migration.db"
    database_url = f"sqlite+pysqlite:///{database_path.as_posix()}"
    backend_root = Path(__file__).resolve().parents[1]
    monkeypatch.setenv("ASTRA_DATABASE_URL", database_url)
    get_settings.cache_clear()
    reset_database_state()
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "alembic"))
    engine = create_engine(database_url)
    try:
        command.upgrade(config, "20260727_0051")
        with engine.begin() as connection:
            connection.execute(
                text(
                    """
                    INSERT INTO code_submissions (
                        id, school_id, course_id, class_id, course_unit_id, activity_key,
                        problem_id, problem_version_id, student_id, language, source_code, stdin,
                        source_sha256, input_sha256, problem_snapshot_json,
                        resource_policy_snapshot_json, status, result_summary_json, judged_at,
                        created_at, updated_at
                    ) VALUES (
                        41, 1, 1, 1, 1, 'migration.activity', 1, 1, 1, 'python',
                        'print(3)', '', :source_sha256, :input_sha256, '{}', '{}',
                        'runner_unavailable', '{}', NULL, :created_at, :created_at
                    )
                    """
                ),
                {
                    "source_sha256": sha256(b"print(3)").hexdigest(),
                    "input_sha256": sha256(b"").hexdigest(),
                    "created_at": "2026-08-09 00:00:00.000000",
                },
            )
            connection.execute(
                text(
                    """
                    INSERT INTO code_judge_attempts (
                        id, submission_id, attempt_number, status, adapter_name,
                        resource_policy_snapshot_json, result_summary_json, available_at,
                        claim_owner, claim_token, claim_expires_at, started_at, finished_at,
                        error_code, created_at, updated_at
                    ) VALUES (
                        51, 41, 1, 'runner_unavailable', 'disabled', '{}', '{}', :created_at,
                        NULL, NULL, NULL, NULL, NULL, 'runner_disabled', :created_at, :created_at
                    )
                    """
                ),
                {"created_at": "2026-08-09 00:00:00.000000"},
            )

        command.upgrade(config, "20260809_0052")
        columns = {column["name"]: column for column in inspect(engine).get_columns("code_submissions")}
        assert columns["client_submission_id"]["nullable"] is False
        constraints = {
            constraint["name"]: tuple(constraint["column_names"])
            for constraint in inspect(engine).get_unique_constraints("code_submissions")
        }
        assert "uq_code_submissions_student_version_class" not in constraints
        assert constraints["uq_code_submissions_actor_scope_client"] == (
            "student_id",
            "problem_id",
            "class_id",
            "client_submission_id",
        )
        with engine.connect() as connection:
            assert connection.execute(
                text("SELECT client_submission_id FROM code_submissions WHERE id = 41")
            ).scalar_one() == "legacy:41"
            assert connection.execute(
                text("SELECT submission_id FROM code_judge_attempts WHERE id = 51")
            ).scalar_one() == 41

        with engine.begin() as connection:
            connection.execute(
                text(
                    """
                    INSERT INTO code_submissions (
                        id, school_id, course_id, class_id, course_unit_id, activity_key,
                        problem_id, problem_version_id, student_id, client_submission_id,
                        language, source_code, stdin, source_sha256, input_sha256,
                        problem_snapshot_json, resource_policy_snapshot_json, status,
                        result_summary_json, judged_at, created_at, updated_at
                    )
                    SELECT
                        42, school_id, course_id, class_id, course_unit_id, activity_key,
                        problem_id, problem_version_id, student_id, 'migration:revision:0002',
                        language, source_code, stdin, source_sha256, input_sha256,
                        problem_snapshot_json, resource_policy_snapshot_json, status,
                        result_summary_json, judged_at, created_at, updated_at
                    FROM code_submissions WHERE id = 41
                    """
                )
            )
            connection.execute(
                text(
                    """
                    INSERT INTO code_judge_attempts (
                        id, submission_id, attempt_number, status, adapter_name,
                        resource_policy_snapshot_json, result_summary_json, available_at,
                        claim_owner, claim_token, claim_expires_at, started_at, finished_at,
                        error_code, created_at, updated_at
                    )
                    SELECT
                        52, 42, attempt_number, status, adapter_name,
                        resource_policy_snapshot_json, result_summary_json, available_at,
                        claim_owner, claim_token, claim_expires_at, started_at, finished_at,
                        error_code, created_at, updated_at
                    FROM code_judge_attempts WHERE id = 51
                    """
                )
            )

        with engine.connect() as connection:
            migrated_rows = connection.execute(
                text(
                    "SELECT client_submission_id, source_code FROM code_submissions "
                    "WHERE id IN (41, 42) ORDER BY id"
                )
            ).all()
            # A pre-BE-014 row has no recoverable historical client key. Its
            # legacy:id backfill therefore cannot replay a later explicit key,
            # even when the source bytes are identical.
            assert migrated_rows == [
                ("legacy:41", "print(3)"),
                ("migration:revision:0002", "print(3)"),
            ]

        with pytest.raises(IntegrityError):
            with engine.begin() as connection:
                connection.execute(
                    text(
                        """
                        INSERT INTO code_submissions (
                            id, school_id, course_id, class_id, course_unit_id, activity_key,
                            problem_id, problem_version_id, student_id, client_submission_id,
                            language, source_code, stdin, source_sha256, input_sha256,
                            problem_snapshot_json, resource_policy_snapshot_json, status,
                            result_summary_json, judged_at, created_at, updated_at
                        )
                        SELECT
                            43, school_id, course_id, class_id, course_unit_id, activity_key,
                            problem_id, problem_version_id, student_id, client_submission_id,
                            language, source_code, stdin, source_sha256, input_sha256,
                            problem_snapshot_json, resource_policy_snapshot_json, status,
                            result_summary_json, judged_at, created_at, updated_at
                        FROM code_submissions WHERE id = 42
                        """
                    )
                )

        with pytest.raises(RuntimeError, match="cannot downgrade BE-014"):
            command.downgrade(config, "20260727_0051")
        with engine.connect() as connection:
            assert connection.execute(text("SELECT COUNT(*) FROM code_submissions")).scalar_one() == 2
            assert connection.execute(text("SELECT COUNT(*) FROM code_judge_attempts")).scalar_one() == 2

        with engine.begin() as connection:
            connection.execute(text("DELETE FROM code_judge_attempts WHERE submission_id = 42"))
            connection.execute(text("DELETE FROM code_submissions WHERE id = 42"))
        command.downgrade(config, "20260727_0051")
        assert "client_submission_id" not in {
            column["name"] for column in inspect(engine).get_columns("code_submissions")
        }
        with engine.connect() as connection:
            assert connection.execute(text("SELECT id FROM code_submissions")).scalar_one() == 41
            assert connection.execute(text("SELECT submission_id FROM code_judge_attempts")).scalar_one() == 41
        command.upgrade(config, "20260809_0052")
        with engine.connect() as connection:
            assert connection.execute(
                text("SELECT client_submission_id FROM code_submissions WHERE id = 41")
            ).scalar_one() == "legacy:41"
    finally:
        engine.dispose()
        reset_database_state()
        get_settings.cache_clear()

    ddl = str(CreateTable(CodeSubmission.__table__).compile(dialect=mysql.dialect()))
    assert "client_submission_id" in ddl
    assert "ascii_bin" in ddl
    assert "uq_code_submissions_actor_scope_client" in ddl


@pytest.mark.mysql_release_evidence
def test_0052_mysql_schema_when_explicit_release_drill_is_configured():
    database_url = os.environ.get("ASTRA_TEST_MYSQL_URL", "").strip()
    expected_database = os.environ.get("ASTRA_TEST_MYSQL_DATABASE", "").strip()
    if not database_url or not expected_database:
        pytest.skip("set ASTRA_TEST_MYSQL_URL and ASTRA_TEST_MYSQL_DATABASE for the explicit MySQL release drill")
    engine = make_engine(database_url)
    try:
        assert engine.dialect.name == "mysql"
        assert engine.url.database == expected_database
        tables = set(inspect(engine).get_table_names())
        assert {"code_problems", "code_problem_versions", "code_submissions", "code_judge_attempts"} <= tables
        submission_columns = {column["name"] for column in inspect(engine).get_columns("code_submissions")}
        assert {
            "client_submission_id",
            "problem_snapshot_json",
            "resource_policy_snapshot_json",
            "source_code",
            "status",
        } <= submission_columns
        submission_uniques = {
            constraint["name"]: tuple(constraint["column_names"])
            for constraint in inspect(engine).get_unique_constraints("code_submissions")
        }
        assert submission_uniques["uq_code_submissions_actor_scope_client"] == (
            "student_id",
            "problem_id",
            "class_id",
            "client_submission_id",
        )
        assert "ix_code_judge_attempts_expired_claim" in {
            index["name"] for index in inspect(engine).get_indexes("code_judge_attempts")
        }
    finally:
        engine.dispose()
