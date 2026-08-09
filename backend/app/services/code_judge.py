"""Persistence and lease contracts for code judging.

This module deliberately contains no evaluator, shell invocation, subprocess
usage, dynamic evaluation, or outbound network client. A separately deployed
runner may implement the adapter protocol after an explicit security review.
"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
from hashlib import sha256
import json
import re
from threading import RLock
from typing import Any, Protocol
from uuid import uuid4

from sqlalchemy import case, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from app.models import CodeJudgeAttempt, CodeProblem, CodeProblemVersion, CodeSubmission, CourseUnit
from app.models.base import utc_now


CANONICAL_LANGUAGES = {"javascript", "python", "c", "cpp"}
QUEUED = "queued"
RUNNER_UNAVAILABLE = "runner_unavailable"
RUNNING = "running"
TERMINAL_STATUSES = {
    "accepted",
    "wrong_answer",
    "partial",
    "compile_error",
    "runtime_error",
    "time_limit",
    "memory_limit",
    "output_limit",
    "internal_error",
    "cancelled",
}
ALL_STATUSES = {QUEUED, RUNNER_UNAVAILABLE, RUNNING, *TERMINAL_STATUSES}
EXPIRED_CLAIM_RECOVERY_BATCH_SIZE = 100
_CLIENT_SUBMISSION_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{7,127}")
_SQLITE_SUBMISSION_WRITE_LOCK = RLock()
_SUBMISSION_STATUS_PRIORITY = {
    "accepted": 120,
    "partial": 110,
    "wrong_answer": 100,
    "compile_error": 90,
    "runtime_error": 80,
    "time_limit": 70,
    "memory_limit": 60,
    "output_limit": 50,
    "internal_error": 40,
    RUNNING: 30,
    QUEUED: 20,
    RUNNER_UNAVAILABLE: 10,
    "cancelled": 0,
}


@dataclass(frozen=True)
class RunnerAvailability:
    available: bool
    adapter_name: str
    reason: str | None = None


class CodeRunnerAdapter(Protocol):
    """Contract only; implementations belong outside the API process."""

    def availability(self) -> RunnerAvailability:
        ...


class DisabledCodeRunnerAdapter:
    """Safe default. It cannot execute, dispatch, or contact a provider."""

    def availability(self) -> RunnerAvailability:
        return RunnerAvailability(available=False, adapter_name="disabled", reason="runner_disabled")


@dataclass(frozen=True)
class CodeJudgeLease:
    attempt_id: int
    submission_id: int
    attempt_number: int
    worker_id: str
    claim_token: str
    claim_expires_at: datetime
    language: str
    source_code: str
    stdin: str
    problem_snapshot: dict[str, Any]
    resource_policy: dict[str, Any]


@dataclass(frozen=True)
class SubmissionCreateResult:
    submission: CodeSubmission
    created: bool
    idempotent_replay: bool


@contextmanager
def code_submission_write_guard(db: Session):
    """Serialize only single-process local SQLite writes.

    This is not a production/distributed lock. MySQL correctness comes from
    row locking plus the actor/scope/client unique key and savepoint re-read.
    """
    if db.get_bind().dialect.name == "sqlite":
        with _SQLITE_SUBMISSION_WRITE_LOCK:
            yield
        return
    yield


def create_problem(
    db: Session,
    *,
    school_id: int,
    course_id: int,
    unit: CourseUnit,
    title: str,
    statement_markdown: str,
    test_cases: list[dict[str, Any]],
    language_allowlist: list[str],
    resource_policy: dict[str, Any],
    source_max_bytes: int,
    input_max_bytes: int,
    output_max_bytes: int,
    created_by_user_id: int,
) -> tuple[CodeProblem, CodeProblemVersion]:
    if unit.course_id != course_id:
        raise ValueError("course unit does not belong to problem course")
    problem = CodeProblem(
        school_id=school_id,
        course_id=course_id,
        course_unit_id=unit.id,
        activity_key=unit.activity_key,
        title=title,
        status="active",
        created_by_user_id=created_by_user_id,
    )
    db.add(problem)
    db.flush()
    version = _new_problem_version(
        problem_id=problem.id,
        version_number=1,
        statement_markdown=statement_markdown,
        test_cases=test_cases,
        language_allowlist=language_allowlist,
        resource_policy=resource_policy,
        source_max_bytes=source_max_bytes,
        input_max_bytes=input_max_bytes,
        output_max_bytes=output_max_bytes,
        created_by_user_id=created_by_user_id,
    )
    db.add(version)
    db.flush()
    return problem, version


def create_problem_version(
    db: Session,
    *,
    problem: CodeProblem,
    statement_markdown: str,
    test_cases: list[dict[str, Any]],
    language_allowlist: list[str],
    resource_policy: dict[str, Any],
    source_max_bytes: int,
    input_max_bytes: int,
    output_max_bytes: int,
    created_by_user_id: int,
) -> CodeProblemVersion:
    next_number = int(
        db.scalar(
            select(func.coalesce(func.max(CodeProblemVersion.version_number), 0)).where(
                CodeProblemVersion.problem_id == problem.id
            )
        )
        or 0
    ) + 1
    version = _new_problem_version(
        problem_id=problem.id,
        version_number=next_number,
        statement_markdown=statement_markdown,
        test_cases=test_cases,
        language_allowlist=language_allowlist,
        resource_policy=resource_policy,
        source_max_bytes=source_max_bytes,
        input_max_bytes=input_max_bytes,
        output_max_bytes=output_max_bytes,
        created_by_user_id=created_by_user_id,
    )
    db.add(version)
    db.flush()
    return version


def active_problem_version(
    db: Session,
    problem_id: int,
    *,
    locking_read: bool = False,
) -> CodeProblemVersion:
    statement = (
        select(CodeProblemVersion)
        .where(CodeProblemVersion.problem_id == problem_id, CodeProblemVersion.status == "active")
        .order_by(CodeProblemVersion.version_number.desc())
        .limit(1)
    )
    if locking_read:
        statement = statement.with_for_update()
    version = db.scalar(statement.execution_options(populate_existing=True))
    if version is None:
        raise ValueError("code problem has no active version")
    return version


def create_code_submission(
    db: Session,
    *,
    problem: CodeProblem,
    version: CodeProblemVersion,
    student_id: int,
    class_id: int,
    language: str,
    source_code: str,
    stdin: str,
    client_submission_id: str | None = None,
    adapter: CodeRunnerAdapter | None = None,
) -> SubmissionCreateResult:
    if version.problem_id != problem.id:
        raise ValueError("problem version does not belong to code problem")
    source_sha256 = _sha256_text(source_code)
    input_sha256 = _sha256_text(stdin)
    stable_client_id = _normalize_client_submission_id(
        client_submission_id,
        language=language,
        problem_version_id=version.id,
        source_sha256=source_sha256,
        input_sha256=input_sha256,
    )
    existing = _idempotent_submission(
        db,
        student_id=student_id,
        problem_id=problem.id,
        class_id=class_id,
        client_submission_id=stable_client_id,
        locking_read=True,
    )
    if existing is not None:
        _assert_idempotent_match(existing, language, source_sha256, input_sha256)
        return SubmissionCreateResult(existing, created=False, idempotent_replay=True)

    _validate_submission_payload(version, language=language, source_code=source_code, stdin=stdin)
    availability = (adapter or DisabledCodeRunnerAdapter()).availability()
    initial_status = QUEUED if availability.available else RUNNER_UNAVAILABLE
    snapshot = problem_snapshot(problem, version)
    submission = CodeSubmission(
        school_id=problem.school_id,
        course_id=problem.course_id,
        class_id=class_id,
        course_unit_id=problem.course_unit_id,
        activity_key=problem.activity_key,
        problem_id=problem.id,
        problem_version_id=version.id,
        student_id=student_id,
        client_submission_id=stable_client_id,
        language=language,
        source_code=source_code,
        stdin=stdin,
        source_sha256=source_sha256,
        input_sha256=input_sha256,
        problem_snapshot_json=snapshot,
        resource_policy_snapshot_json=dict(version.resource_policy_json or {}),
        status=initial_status,
        result_summary_json={"runner_state": availability.reason} if not availability.available else {},
    )
    attempt = CodeJudgeAttempt(
        attempt_number=1,
        status=initial_status,
        adapter_name=availability.adapter_name,
        resource_policy_snapshot_json=dict(version.resource_policy_json or {}),
        result_summary_json={"runner_state": availability.reason} if not availability.available else {},
        available_at=utc_now(),
        error_code=availability.reason if not availability.available else None,
    )
    try:
        with db.begin_nested():
            db.add(submission)
            db.flush()
            attempt.submission_id = submission.id
            db.add(attempt)
            db.flush()
    except IntegrityError:
        existing = _idempotent_submission(
            db,
            student_id=student_id,
            problem_id=problem.id,
            class_id=class_id,
            client_submission_id=stable_client_id,
            locking_read=True,
        )
        if existing is None:
            raise
        _assert_idempotent_match(existing, language, source_sha256, input_sha256)
        return SubmissionCreateResult(existing, created=False, idempotent_replay=True)
    return SubmissionCreateResult(submission, created=True, idempotent_replay=False)


def submission_projection_columns():
    """Return correlated latest/best ids for a submission list row."""
    latest_candidate = aliased(CodeSubmission)
    best_candidate = aliased(CodeSubmission)
    latest_id = (
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
    best_id = (
        select(best_candidate.id)
        .where(
            best_candidate.student_id == CodeSubmission.student_id,
            best_candidate.problem_id == CodeSubmission.problem_id,
            best_candidate.class_id == CodeSubmission.class_id,
        )
        .order_by(
            _submission_status_priority(best_candidate.status).desc(),
            best_candidate.created_at.desc(),
            best_candidate.id.desc(),
        )
        .limit(1)
        .correlate(CodeSubmission)
        .scalar_subquery()
    )
    return latest_id, best_id


def submission_projection_flags(db: Session, submission: CodeSubmission) -> tuple[bool, bool]:
    latest_id = (
        select(CodeSubmission.id)
        .where(
            CodeSubmission.student_id == submission.student_id,
            CodeSubmission.problem_id == submission.problem_id,
            CodeSubmission.class_id == submission.class_id,
        )
        .order_by(CodeSubmission.created_at.desc(), CodeSubmission.id.desc())
        .limit(1)
        .scalar_subquery()
    )
    best_id = (
        select(CodeSubmission.id)
        .where(
            CodeSubmission.student_id == submission.student_id,
            CodeSubmission.problem_id == submission.problem_id,
            CodeSubmission.class_id == submission.class_id,
        )
        .order_by(
            _submission_status_priority(CodeSubmission.status).desc(),
            CodeSubmission.created_at.desc(),
            CodeSubmission.id.desc(),
        )
        .limit(1)
        .scalar_subquery()
    )
    projection = db.execute(select(latest_id.label("latest_id"), best_id.label("best_id"))).one()
    return submission.id == projection.latest_id, submission.id == projection.best_id


def claim_next_code_judge_attempt(
    db: Session,
    *,
    worker_id: str,
    lease_seconds: int,
    adapter: CodeRunnerAdapter,
    now: datetime | None = None,
) -> CodeJudgeLease | None:
    availability = adapter.availability()
    if not availability.available:
        return None
    now_value = now or utc_now()
    _requeue_expired_claims(db, now_value)
    candidate_ids = list(
        db.scalars(
            select(CodeJudgeAttempt.id)
            .where(CodeJudgeAttempt.status == QUEUED, CodeJudgeAttempt.available_at <= now_value)
            .order_by(CodeJudgeAttempt.available_at, CodeJudgeAttempt.id)
            .limit(50)
        ).all()
    )
    for attempt_id in candidate_ids:
        claim_token = uuid4().hex
        claim_expires_at = now_value + timedelta(seconds=lease_seconds)
        claimed = db.execute(
            update(CodeJudgeAttempt)
            .where(CodeJudgeAttempt.id == attempt_id, CodeJudgeAttempt.status == QUEUED)
            .values(
                status=RUNNING,
                adapter_name=availability.adapter_name,
                claim_owner=worker_id,
                claim_token=claim_token,
                claim_expires_at=claim_expires_at,
                started_at=now_value,
                finished_at=None,
                error_code=None,
            )
            .execution_options(synchronize_session=False)
        )
        if claimed.rowcount != 1:
            db.rollback()
            continue
        attempt = db.get(CodeJudgeAttempt, attempt_id)
        if attempt is None:
            db.rollback()
            continue
        transitioned = db.execute(
            update(CodeSubmission)
            .where(CodeSubmission.id == attempt.submission_id, CodeSubmission.status == QUEUED)
            .values(status=RUNNING)
            .execution_options(synchronize_session=False)
        )
        if transitioned.rowcount != 1:
            db.rollback()
            continue
        submission = db.get(CodeSubmission, attempt.submission_id)
        if submission is None:
            db.rollback()
            continue
        db.commit()
        return CodeJudgeLease(
            attempt_id=attempt.id,
            submission_id=submission.id,
            attempt_number=attempt.attempt_number,
            worker_id=worker_id,
            claim_token=claim_token,
            claim_expires_at=claim_expires_at,
            language=submission.language,
            source_code=submission.source_code,
            stdin=submission.stdin,
            problem_snapshot=dict(submission.problem_snapshot_json or {}),
            resource_policy=dict(submission.resource_policy_snapshot_json or {}),
        )
    db.commit()
    return None


def retry_submission_if_runner_available(
    db: Session,
    *,
    submission: CodeSubmission,
    adapter: CodeRunnerAdapter,
) -> bool:
    availability = adapter.availability()
    if not availability.available:
        return False
    if submission.status not in {RUNNER_UNAVAILABLE, "internal_error", "cancelled"}:
        return False
    next_number = int(
        db.scalar(
            select(func.coalesce(func.max(CodeJudgeAttempt.attempt_number), 0)).where(
                CodeJudgeAttempt.submission_id == submission.id
            )
        )
        or 0
    ) + 1
    try:
        with db.begin_nested():
            db.add(
                CodeJudgeAttempt(
                    submission_id=submission.id,
                    attempt_number=next_number,
                    status=QUEUED,
                    adapter_name=availability.adapter_name,
                    resource_policy_snapshot_json=dict(submission.resource_policy_snapshot_json or {}),
                    result_summary_json={},
                    available_at=utc_now(),
                )
            )
            submission.status = QUEUED
            submission.result_summary_json = {}
            db.flush()
    except IntegrityError:
        return False
    return True


def record_judge_result(
    db: Session,
    *,
    lease: CodeJudgeLease,
    status: str,
    result_summary: dict[str, Any] | None = None,
    now: datetime | None = None,
) -> bool:
    if status not in TERMINAL_STATUSES:
        raise ValueError("judge result must be terminal")
    now_value = now or utc_now()
    attempt_result = db.execute(
        update(CodeJudgeAttempt)
        .where(
            CodeJudgeAttempt.id == lease.attempt_id,
            CodeJudgeAttempt.status == RUNNING,
            CodeJudgeAttempt.claim_owner == lease.worker_id,
            CodeJudgeAttempt.claim_token == lease.claim_token,
            CodeJudgeAttempt.claim_expires_at > now_value,
        )
        .values(
            status=status,
            result_summary_json=result_summary or {},
            claim_owner=None,
            claim_token=None,
            claim_expires_at=None,
            finished_at=now_value,
            error_code=None,
        )
        .execution_options(synchronize_session=False)
    )
    if attempt_result.rowcount != 1:
        db.rollback()
        return False
    submission_result = db.execute(
        update(CodeSubmission)
        .where(CodeSubmission.id == lease.submission_id, CodeSubmission.status == RUNNING)
        .values(status=status, result_summary_json=result_summary or {}, judged_at=now_value)
        .execution_options(synchronize_session=False)
    )
    if submission_result.rowcount != 1:
        db.rollback()
        return False
    db.commit()
    return True


def problem_snapshot(problem: CodeProblem, version: CodeProblemVersion) -> dict[str, Any]:
    return {
        "problem_id": problem.id,
        "activity_key": problem.activity_key,
        "title": problem.title,
        "version_id": version.id,
        "version_number": version.version_number,
        "statement_markdown": version.statement_markdown,
        "test_spec": dict(version.test_spec_json or {}),
        "language_allowlist": list(version.language_allowlist_json or []),
        "source_max_bytes": version.source_max_bytes,
        "input_max_bytes": version.input_max_bytes,
        "output_max_bytes": version.output_max_bytes,
        "spec_sha256": version.spec_sha256,
    }


def _new_problem_version(**values: Any) -> CodeProblemVersion:
    language_allowlist = list(values["language_allowlist"])
    resource_policy = dict(values["resource_policy"])
    test_spec = {"cases": list(values["test_cases"])}
    canonical = {
        "statement_markdown": values["statement_markdown"],
        "test_spec": test_spec,
        "language_allowlist": language_allowlist,
        "resource_policy": resource_policy,
        "source_max_bytes": values["source_max_bytes"],
        "input_max_bytes": values["input_max_bytes"],
        "output_max_bytes": values["output_max_bytes"],
    }
    return CodeProblemVersion(
        problem_id=values["problem_id"],
        version_number=values["version_number"],
        status="active",
        statement_markdown=values["statement_markdown"],
        test_spec_json=test_spec,
        language_allowlist_json=language_allowlist,
        resource_policy_json=resource_policy,
        source_max_bytes=values["source_max_bytes"],
        input_max_bytes=values["input_max_bytes"],
        output_max_bytes=values["output_max_bytes"],
        spec_sha256=_sha256_json(canonical),
        created_by_user_id=values["created_by_user_id"],
    )


def _validate_submission_payload(
    version: CodeProblemVersion,
    *,
    language: str,
    source_code: str,
    stdin: str,
) -> None:
    if language not in CANONICAL_LANGUAGES or language not in set(version.language_allowlist_json or []):
        raise ValueError("language is not enabled for this problem version")
    if len(source_code.encode("utf-8")) > version.source_max_bytes:
        raise ValueError("source_code exceeds problem source limit")
    if len(stdin.encode("utf-8")) > version.input_max_bytes:
        raise ValueError("stdin exceeds problem input limit")


def _assert_idempotent_match(
    submission: CodeSubmission,
    language: str,
    source_sha256: str,
    input_sha256: str,
) -> None:
    if (
        submission.language != language
        or submission.source_sha256 != source_sha256
        or submission.input_sha256 != input_sha256
    ):
        raise ValueError("idempotency_conflict")


def _idempotent_submission(
    db: Session,
    *,
    student_id: int,
    problem_id: int,
    class_id: int,
    client_submission_id: str,
    locking_read: bool,
) -> CodeSubmission | None:
    statement = select(CodeSubmission).where(
        CodeSubmission.student_id == student_id,
        CodeSubmission.problem_id == problem_id,
        CodeSubmission.class_id == class_id,
        CodeSubmission.client_submission_id == client_submission_id,
    )
    if locking_read:
        statement = statement.with_for_update()
    return db.scalar(statement.execution_options(populate_existing=True))


def _normalize_client_submission_id(
    value: str | None,
    *,
    language: str,
    problem_version_id: int,
    source_sha256: str,
    input_sha256: str,
) -> str:
    if value is None:
        return "legacy:" + _sha256_json(
            {
                "language": language,
                "problem_version_id": problem_version_id,
                "source_sha256": source_sha256,
                "input_sha256": input_sha256,
            }
        )
    if value.startswith("legacy:") or not _CLIENT_SUBMISSION_ID_PATTERN.fullmatch(value):
        raise ValueError("client_submission_id must be an opaque stable identifier")
    return value


def _submission_status_priority(status_column):
    return case(
        *((status_column == status_name, priority) for status_name, priority in _SUBMISSION_STATUS_PRIORITY.items()),
        else_=-1,
    )


def _requeue_expired_claims(db: Session, now_value: datetime) -> int:
    """Return a bounded, deterministic batch of expired claims to the queue."""
    expired = list(
        db.execute(
            select(CodeJudgeAttempt.id, CodeJudgeAttempt.submission_id)
            .where(
                CodeJudgeAttempt.status == RUNNING,
                CodeJudgeAttempt.claim_expires_at.is_not(None),
                CodeJudgeAttempt.claim_expires_at <= now_value,
            )
            .order_by(CodeJudgeAttempt.claim_expires_at, CodeJudgeAttempt.id)
            .limit(EXPIRED_CLAIM_RECOVERY_BATCH_SIZE)
        ).all()
    )
    if not expired:
        return 0
    attempt_ids = [int(row.id) for row in expired]
    submission_ids = [int(row.submission_id) for row in expired]
    recovered = db.execute(
        update(CodeJudgeAttempt)
        .where(
            CodeJudgeAttempt.id.in_(attempt_ids),
            CodeJudgeAttempt.status == RUNNING,
            CodeJudgeAttempt.claim_expires_at.is_not(None),
            CodeJudgeAttempt.claim_expires_at <= now_value,
        )
        .values(
            status=QUEUED,
            claim_owner=None,
            claim_token=None,
            claim_expires_at=None,
            error_code="claim_expired",
            available_at=now_value,
        )
        .execution_options(synchronize_session=False)
    )
    db.execute(
        update(CodeSubmission)
        .where(CodeSubmission.id.in_(submission_ids), CodeSubmission.status == RUNNING)
        .values(status=QUEUED)
        .execution_options(synchronize_session=False)
    )
    return int(recovered.rowcount or 0)


def _sha256_text(value: str) -> str:
    return sha256(value.encode("utf-8")).hexdigest()


def _sha256_json(value: dict[str, Any]) -> str:
    return sha256(json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
