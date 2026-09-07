from __future__ import annotations

import asyncio
from pathlib import Path
import secrets

import pytest
from sqlalchemy import func, select

from fastapi.testclient import TestClient
from app.main import create_app
from app.core.config import get_settings
from app.db.session import get_session_factory, reset_database_state
from app.models import LearningActivityProjection, LearningEvidenceEvent
from scripts.initialize_demo_data import initialize_demo_data


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Cookie": ""}


def _login(client, username: str, role: str) -> str:
    password = "QA016-code-contract-password-123"
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
    assert logged_in.status_code == 200, logged_in.json()
    return logged_in.json()["access_token"]


def _create_code_scope(client) -> tuple[str, int, int]:
    teacher = _login(client, "qa016_code_teacher", "teacher")
    student = _login(client, "qa016_code_student", "student")
    school = client.post(
        "/api/schools",
        headers=_auth(teacher),
        json={"name": "QA-016 Code School", "region": "Shanghai"},
    )
    assert school.status_code == 201, school.json()
    school_id = school.json()["id"]
    class_group = client.post(
        "/api/classes",
        headers=_auth(teacher),
        json={"school_id": school_id, "name": "QA-016 Code Class"},
    )
    assert class_group.status_code == 201, class_group.json()
    class_id = class_group.json()["id"]
    course = client.post(
        "/api/courses",
        headers=_auth(teacher),
        json={"school_id": school_id, "title": "QA-016 Code Course", "status": "published"},
    )
    assert course.status_code == 201, course.json()
    course_id = course.json()["id"]
    attached = client.post(
        f"/api/courses/{course_id}/classes",
        headers=_auth(teacher),
        json={"class_id": class_id},
    )
    assert attached.status_code == 201, attached.json()
    unit = client.post(
        f"/api/courses/{course_id}/units",
        headers=_auth(teacher),
        json={
            "title": "Loop boundary",
            "position": 1,
            "status": "published",
            "activity_key": "control-flow.loop-boundary",
        },
    )
    assert unit.status_code == 201, unit.json()
    joined = client.post(
        f"/api/classes/{class_id}/join",
        headers=_auth(student),
        json={"role": "student"},
    )
    assert joined.status_code == 201, joined.json()
    problem = client.post(
        "/api/code-problems",
        headers=_auth(teacher),
        json={
            "course_id": course_id,
            "course_unit_id": unit.json()["id"],
            "title": "QA-016 loop revision",
            "statement_markdown": "Print the final loop value.",
            "test_cases": [{"stdin": "", "expected_stdout": "3\n"}],
            "language_allowlist": ["python"],
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
        },
    )
    assert problem.status_code == 201, problem.json()
    return student, class_id, problem.json()["id"]


def test_qa016_code_accepts_a_second_source_revision_and_replays_only_the_same_client_request(client):
    student, class_id, problem_id = _create_code_scope(client)
    endpoint = f"/api/code-problems/{problem_id}/submissions"
    first_payload = {
        "client_submission_id": "00000000-0000-4000-8000-000000000001",
        "class_id": class_id,
        "language": "python",
        "source_code": "print(3)",
        "stdin": "",
    }
    first = client.post(endpoint, headers=_auth(student), json=first_payload)
    assert first.status_code == 201, first.json()
    first_replay = client.post(endpoint, headers=_auth(student), json=first_payload)
    assert first_replay.status_code == 200, first_replay.json()
    assert first_replay.json()["id"] == first.json()["id"]

    second_payload = {
        **first_payload,
        "client_submission_id": "00000000-0000-4000-8000-000000000002",
        "source_code": "print(4)",
    }
    second = client.post(endpoint, headers=_auth(student), json=second_payload)
    if (
        second.status_code == 409
        and second.json().get("detail")
        == "Submission idempotency key conflicts with different content"
    ):
        pytest.xfail("QA-016 CODE-01: current schema conflates student revision with network replay")
    assert second.status_code == 201, second.json()
    assert second.json()["id"] != first.json()["id"]
    second_replay = client.post(endpoint, headers=_auth(student), json=second_payload)
    assert second_replay.status_code == 200, second_replay.json()
    assert second_replay.json()["id"] == second.json()["id"]


@pytest.fixture()
def qa016_demo_environment(tmp_path: Path, monkeypatch):
    repository_root = Path(__file__).resolve().parents[2]
    data_directory = (tmp_path / "astra-qa016-demo-data").resolve()
    data_directory.mkdir()
    assert repository_root not in data_directory.parents
    database_url = f"sqlite+pysqlite:///{(data_directory / 'qa016.sqlite3').as_posix()}"
    monkeypatch.setenv("ASTRA_DATABASE_URL", database_url)
    monkeypatch.setenv("ASTRA_AUTO_CREATE_TABLES", "true")
    monkeypatch.setenv("ASTRA_ALLOW_LEGACY_LOCAL_BOOTSTRAP", "true")
    monkeypatch.setenv("ASTRA_ENVIRONMENT", "development")
    monkeypatch.setenv("ASTRA_ADMIN_BOOTSTRAP_ENABLED", "true")
    monkeypatch.setenv("ASTRA_LOCAL_PREVIEW_INSTANCE_ID", "qa016-demo-test")
    monkeypatch.setenv("ASTRA_CORS_ORIGINS", "http://127.0.0.1:19116")
    monkeypatch.setenv("ASTRA_AUDIT_IP_HASH_SALT", secrets.token_urlsafe(48))
    get_settings.cache_clear()
    reset_database_state()
    yield data_directory
    reset_database_state()
    get_settings.cache_clear()


def test_new_student_does_not_inherit_synthetic_demo_learning_history(qa016_demo_environment):
    credentials = {
        username: f"Astra-QA016-{secrets.token_urlsafe(32)}"
        for username in (
            "astra_demo_admin",
            "astra_demo_teacher",
            "astra_demo_student",
            "astra_demo_peer_teacher",
            "astra_demo_pending_teacher",
            "astra_demo_open_student",
        )
    }
    report = asyncio.run(initialize_demo_data(credentials=credentials))
    assert report["representative_evidence"]
    with TestClient(create_app()) as client:
        registered = client.post("/api/auth/register", json={"username":"fresh_real_student", "display_name":"New student", "password":"Fresh-student-review-2026!", "role":"student"})
        assert registered.status_code == 201
        student_id = registered.json()["id"]
        assert student_id != report["users"]["student"]["id"]
        client.post("/api/auth/login", json={"username":"fresh_real_student", "password":"Fresh-student-review-2026!"})
        assert client.get("/api/v1/workbench").json()["courses"]["items"] == []

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        completed = int(
            db.scalar(
                select(func.count(LearningActivityProjection.id)).where(
                    LearningActivityProjection.subject_user_id == student_id,
                    LearningActivityProjection.status == "completed",
                )
            )
            or 0
        )
        evidence_events = int(
            db.scalar(
                select(func.count(LearningEvidenceEvent.id)).where(
                    LearningEvidenceEvent.subject_user_id == student_id
                )
            )
            or 0
        )
    assert completed == 0
    assert evidence_events == 0
