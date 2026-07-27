from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
import pytest
from sqlalchemy import create_engine, event, func, inspect, select, text
from sqlalchemy.dialects import mysql
from sqlalchemy.schema import CreateIndex, CreateTable

from app.core.config import get_settings
from app.db.session import get_session_factory, make_engine, reset_database_state
from app.models import CodeJudgeAttempt, CodeProblem, CodeProblemVersion, CodeSubmission, Course, User
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

    payload = {"class_id": class_id, "language": "py", "source_code": "print(1 + 2)", "stdin": ""}
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
        json={**payload, "source_code": "x" * 129},
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

    statements: list[str] = []
    engine = make_engine(get_settings().database_url)

    def capture_statement(_connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture_statement)
    try:
        page = client.get(f"/api/code-submissions?class_id={class_id}&limit=3&offset=0", headers=_auth(student))
    finally:
        event.remove(engine, "before_cursor_execute", capture_statement)
    assert page.status_code == 200
    assert page.json()["total"] == 6
    assert len(page.json()["items"]) == 3
    assert page.json()["next_offset"] == 3
    # Authentication and class-scope checks account for the fixed overhead;
    # the page itself is one count plus one limited SQL query, not per row.
    assert len(statements) <= 8


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
        assert ScriptDirectory.from_config(config).get_heads() == ["20260727_0051"]
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


@pytest.mark.mysql_release_evidence
def test_0050_mysql_schema_when_explicit_release_drill_is_configured():
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
        assert {"problem_snapshot_json", "resource_policy_snapshot_json", "source_code", "status"} <= submission_columns
        assert "ix_code_judge_attempts_expired_claim" in {
            index["name"] for index in inspect(engine).get_indexes("code_judge_attempts")
        }
    finally:
        engine.dispose()
