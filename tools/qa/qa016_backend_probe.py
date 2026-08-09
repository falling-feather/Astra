from __future__ import annotations

import argparse
import asyncio
from contextlib import contextmanager
from hashlib import sha256
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile
from typing import Any, Iterator


ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import func, select  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.db.session import get_session_factory, reset_database_state  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import (  # noqa: E402
    Assignment,
    CodeJudgeAttempt,
    CodeSubmission,
    Course,
    CourseUnit,
    LearningActivityProjection,
    LearningEvidenceEvent,
    Submission,
)
from scripts.initialize_demo_data import initialize_demo_data  # noqa: E402


QA_PREFIX = "astra-qa016-"


def _database_url(database_path: Path) -> str:
    return f"sqlite+pysqlite:///{database_path.as_posix()}"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Cookie": ""}


def _response_body(response) -> Any:
    try:
        return response.json()
    except Exception:
        return {"text": response.text[:500]}


def _login(client: TestClient, username: str, password: str) -> str:
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    if response.status_code != 200:
        raise RuntimeError(f"login failed for {username}: {response.status_code} {_response_body(response)}")
    return response.json()["access_token"]


def _safe_temp_root() -> Path:
    root = Path(tempfile.gettempdir()).resolve()
    if not root.is_absolute() or root == Path(root.anchor):
        raise RuntimeError("system temporary root is not a safe task parent")
    return root


def _assert_owned_data_directory(data_directory: Path, temp_root: Path) -> Path:
    resolved = data_directory.resolve(strict=False)
    if resolved.parent != temp_root:
        raise RuntimeError(f"QA-016 data directory escaped the system temp root: {resolved}")
    if not resolved.name.startswith(QA_PREFIX):
        raise RuntimeError(f"QA-016 data directory has an unexpected name: {resolved.name}")
    if resolved.is_symlink():
        raise RuntimeError("QA-016 data directory must not be a symlink")
    return resolved


@contextmanager
def _fresh_data_directory(*, keep: bool) -> Iterator[tuple[Path, dict[str, Any]]]:
    temp_root = _safe_temp_root()
    data_directory = Path(tempfile.mkdtemp(prefix=QA_PREFIX, dir=temp_root))
    resolved = _assert_owned_data_directory(data_directory, temp_root)
    environment = {
        "data_directory_kind": "system-temp",
        "data_directory_leaf": resolved.name,
        "repository_external": ROOT not in resolved.parents,
        "created_by": "QA-016",
        "cleanup": "pending",
    }
    try:
        yield resolved, environment
    finally:
        reset_database_state()
        get_settings.cache_clear()
        if keep:
            environment["cleanup"] = "kept-by-explicit-flag"
        else:
            verified = _assert_owned_data_directory(resolved, temp_root)
            if verified.exists():
                shutil.rmtree(verified)
            environment["cleanup"] = "verified-removed" if not verified.exists() else "cleanup-failed"


def _configure_environment(data_directory: Path) -> None:
    values = {
        "ASTRA_DATABASE_URL": _database_url(data_directory / "qa016.sqlite3"),
        "ASTRA_AUTO_CREATE_TABLES": "true",
        "ASTRA_ENVIRONMENT": "development",
        "ASTRA_ADMIN_BOOTSTRAP_ENABLED": "true",
        "ASTRA_LOCAL_PREVIEW_INSTANCE_ID": f"qa016-{data_directory.name}",
        "ASTRA_CORS_ORIGINS": "http://127.0.0.1:19116",
        "ASTRA_AUDIT_IP_HASH_SALT": secrets.token_urlsafe(48),
        "ASTRA_AUDIT_TRUST_FORWARDED_FOR": "false",
        "ASTRA_BACKGROUND_TASK_WORKER_ENABLED": "false",
        "ASTRA_KNOWLEDGE_SNAPSHOT_SCHEDULER_ENABLED": "false",
        "ASTRA_CONTENT_SCRIPT_REMOTE_DRIFT_SCHEDULER_ENABLED": "false",
    }
    os.environ.update(values)
    get_settings.cache_clear()
    reset_database_state()


def _revision() -> str:
    return subprocess.check_output(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        text=True,
        encoding="utf-8",
    ).strip()


def _submission_ledger(class_id: int) -> list[dict[str, Any]]:
    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        rows = db.execute(
            select(Submission.id, Submission.status, Course.id, Course.title)
            .join(Assignment, Submission.assignment_id == Assignment.id)
            .join(CourseUnit, Assignment.unit_id == CourseUnit.id)
            .join(Course, CourseUnit.course_id == Course.id)
            .where(Submission.class_id == class_id)
            .order_by(Submission.id)
        ).all()
    return [
        {"submission_id": row[0], "status": row[1], "course_id": row[2], "course_title": row[3]}
        for row in rows
    ]


def _code_ledger(student_id: int, problem_id: int) -> dict[str, Any]:
    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        submissions = db.scalars(
            select(CodeSubmission)
            .where(CodeSubmission.student_id == student_id, CodeSubmission.problem_id == problem_id)
            .order_by(CodeSubmission.id)
        ).all()
        submission_ids = [item.id for item in submissions]
        attempt_count = int(
            db.scalar(
                select(func.count(CodeJudgeAttempt.id)).where(
                    CodeJudgeAttempt.submission_id.in_(submission_ids or [-1])
                )
            )
            or 0
        )
    return {
        "submission_count": len(submissions),
        "submission_ids": submission_ids,
        "source_sha256": [item.source_sha256 for item in submissions],
        "attempt_count": attempt_count,
    }


def _demo_ledger(student_id: int) -> dict[str, Any]:
    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        projections = db.scalars(
            select(LearningActivityProjection)
            .where(LearningActivityProjection.subject_user_id == student_id)
            .order_by(LearningActivityProjection.activity_key)
        ).all()
        event_count = int(
            db.scalar(
                select(func.count(LearningEvidenceEvent.id)).where(
                    LearningEvidenceEvent.subject_user_id == student_id
                )
            )
            or 0
        )
    return {
        "event_count": event_count,
        "projection_count": len(projections),
        "completed_projection_count": sum(item.status == "completed" for item in projections),
        "projections": [
            {
                "activity_key": item.activity_key,
                "status": item.status,
                "learner_event_count": item.learner_event_count,
                "attempt_count": item.attempt_count,
            }
            for item in projections
        ],
    }


def _run_live_probe(data_directory: Path) -> dict[str, Any]:
    _configure_environment(data_directory)
    credentials = {
        username: f"Astra-QA016-{secrets.token_urlsafe(32)}"
        for username in ("astra_demo_admin", "astra_demo_teacher", "astra_demo_student")
    }
    report = asyncio.run(initialize_demo_data(credentials=credentials))
    student_id = int(report["users"]["student"]["id"])
    class_id = int(report["class_id"])
    physics_course_id = int(report["catalog"]["physics"]["course_id"]) if "course_id" in report["catalog"]["physics"] else 0

    with TestClient(create_app()) as client:
        teacher_token = _login(client, "astra_demo_teacher", credentials["astra_demo_teacher"])
        student_token = _login(client, "astra_demo_student", credentials["astra_demo_student"])

        courses_response = client.get(f"/api/courses?class_id={class_id}", headers=_auth(teacher_token))
        if courses_response.status_code != 200:
            raise RuntimeError(f"course read failed: {courses_response.status_code} {_response_body(courses_response)}")
        courses = courses_response.json()
        physics = next(item for item in courses if item.get("course_key") == "physics")
        physics_course_id = int(physics["id"])

        unscoped_path = (
            f"/api/admin/submissions/pending?class_id={class_id}"
            "&status=submitted&limit=50&offset=0"
        )
        scoped_path = f"{unscoped_path}&course_id={physics_course_id}"
        unscoped_response = client.get(unscoped_path, headers=_auth(teacher_token))
        scoped_response = client.get(scoped_path, headers=_auth(teacher_token))
        if unscoped_response.status_code != 200 or scoped_response.status_code != 200:
            raise RuntimeError(
                f"pending read failed: unscoped={unscoped_response.status_code}, scoped={scoped_response.status_code}"
            )
        unscoped_body = unscoped_response.json()
        scoped_body = scoped_response.json()
        unscoped_course_ids = sorted({int(item["course_id"]) for item in unscoped_body["items"]})
        scoped_course_ids = sorted({int(item["course_id"]) for item in scoped_body["items"]})
        teacher_defect = any(course_id != physics_course_id for course_id in unscoped_course_ids)

        problem_id = int(report["code_runner"]["problem_id"])
        first_submission_id = int(report["code_runner"]["submission_id"])
        first_source_response = client.get(
            f"/api/code-submissions/{first_submission_id}/source",
            headers=_auth(student_token),
        )
        if first_source_response.status_code != 200:
            raise RuntimeError(
                f"first source read failed: {first_source_response.status_code} {_response_body(first_source_response)}"
            )
        first_source = first_source_response.json()["source_code"]
        revised_source = "print(4)" if first_source != "print(4)" else "print(5)"
        second_request = {
            "client_submission_id": "00000000-0000-4000-8000-00000000a016",
            "class_id": class_id,
            "language": "python",
            "source_code": revised_source,
            "stdin": "",
        }
        second_response = client.post(
            f"/api/code-problems/{problem_id}/submissions",
            headers=_auth(student_token),
            json=second_request,
        )
        second_body = _response_body(second_response)
        code_ledger = _code_ledger(student_id, problem_id)
        code_defect = second_response.status_code == 409 and code_ledger["submission_count"] == 1

        recovery_response = client.get(
            f"/api/learning-evidence/me/recovery?class_id={class_id}&course_id={physics_course_id}",
            headers=_auth(student_token),
        )
        if recovery_response.status_code != 200:
            raise RuntimeError(
                f"demo recovery read failed: {recovery_response.status_code} {_response_body(recovery_response)}"
            )
        recovery_body = recovery_response.json()

    demo_ledger = _demo_ledger(student_id)
    representative = report["representative_evidence"]
    completed_report_items = sorted(
        item["activity_key"] for item in representative.values() if item.get("status") == "completed"
    )
    demo_defect = bool(completed_report_items) and demo_ledger["completed_projection_count"] > 0
    assignment_ledger = _submission_ledger(class_id)

    return {
        "issues": {
            "TEACH-01": {
                "defect_observed": teacher_defect,
                "actual": "Physics 当前范围的前端形状请求未带 course_id，真实 API 返回其他课程待批改项。",
                "request_response": {
                    "frontend_shaped_request": {
                        "method": "GET",
                        "path": unscoped_path,
                        "status": unscoped_response.status_code,
                    },
                    "frontend_shaped_response": {
                        "total": unscoped_body["total"],
                        "course_ids": unscoped_course_ids,
                        "course_titles": sorted({item.get("course_title", "") for item in unscoped_body["items"]}),
                    },
                    "control_request": {
                        "method": "GET",
                        "path": scoped_path,
                        "status": scoped_response.status_code,
                    },
                    "control_response": {
                        "total": scoped_body["total"],
                        "course_ids": scoped_course_ids,
                    },
                },
                "database_or_state_evidence": {
                    "selected_physics_course_id": physics_course_id,
                    "assignment_submission_ledger": assignment_ledger,
                },
            },
            "CODE-01": {
                "defect_observed": code_defect,
                "actual": "同学生、同班、同题版本修改源码后第二次正式提交返回 409，数据库仍只有一条 submission。",
                "request_response": {
                    "first_submission_id": first_submission_id,
                    "second_request": {
                        "method": "POST",
                        "path": f"/api/code-problems/{problem_id}/submissions",
                        "client_submission_id": second_request["client_submission_id"],
                        "class_id": class_id,
                        "language": "python",
                        "source_sha256": sha256(revised_source.encode("utf-8")).hexdigest(),
                    },
                    "second_response": {
                        "status": second_response.status_code,
                        "body": second_body,
                    },
                },
                "database_or_state_evidence": code_ledger,
            },
            "DEMO-01": {
                "defect_observed": demo_defect,
                "actual": "全新演示初始化在任何现场学习前已生成 completed 代表活动与完整学习事件。",
                "request_response": {
                    "initializer_status": report["status"],
                    "initializer_completed_activity_keys": completed_report_items,
                    "student_recovery_request": {
                        "method": "GET",
                        "path": f"/api/learning-evidence/me/recovery?class_id={class_id}&course_id={physics_course_id}",
                        "status": recovery_response.status_code,
                    },
                    "student_recovery_statuses": sorted(
                        {
                            item.get("status")
                            for item in recovery_body.get("activities", [])
                            if item.get("status")
                        }
                    ),
                },
                "database_or_state_evidence": demo_ledger,
            },
        }
    }


def run(*, keep_data: bool) -> dict[str, Any]:
    revision = _revision()
    with _fresh_data_directory(keep=keep_data) as (data_directory, environment):
        report = _run_live_probe(data_directory)
    report["schema"] = "astra.qa016.backend-probe.v1"
    report["task"] = "QA-016"
    report["revision"] = revision
    report["environment"] = environment
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="QA-016 live API/SQLite failure probe")
    parser.add_argument("--keep-data", action="store_true")
    args = parser.parse_args(argv)
    report = run(keep_data=args.keep_data)
    print(json.dumps(report, ensure_ascii=True, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
