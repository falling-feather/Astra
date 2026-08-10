"""Dependency-free values and primitives for learning-evidence owners."""

import hashlib
import json
from contextlib import nullcontext
from datetime import UTC, datetime, timedelta
from threading import RLock
from typing import Any

# A rule may require at most this many learner facts for one derived outcome.
# This is intentionally a teaching-scale bound: larger automated evaluations
# must enter through the trusted-assessment contract instead of expanding an
# append-only rule witness.
MAX_RULE_WITNESS_EVENTS = 100


# The V8 activity kernel keeps at most 256 learner reservations in one run.
# The server applies the same bound before accepting a new runtime fact so an
# exact recovery response cannot exceed the consumer's executable contract.
MAX_ACTIVITY_RUNTIME_LEARNER_EVENTS = 256


LEARNING_ACTIVITY_EVENT_SCHEMA = "astra-learning-activity-event-v1"
LEARNING_ACTIVITY_EVIDENCE_SIDECAR_SCHEMA = (
    "astra-learning-activity-evidence-sidecar-v1"
)
LEARNING_ACTIVITY_RECOVERY_SCHEMA = "astra-learning-activity-recovery-v2"
LEARNING_ACTIVITY_SERVER_RECOVERY_SCHEMA = (
    "astra-learning-activity-server-recovery-v2"
)


MAX_FUTURE_CLOCK_SKEW = timedelta(minutes=5)
LEARNING_EVIDENCE_SQLITE_WRITE_LOCK = RLock()


class LearningEvidenceError(Exception):
    """Stable service error shared by the legacy and runtime owners."""

    def __init__(self, status_code: int, code: str, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.code = code
        self.detail = detail


# External client_event_id values must start with an ASCII alphanumeric
# character, so this prefix is reserved for server-derived ledger rows.
RULE_DERIVED_CLIENT_EVENT_PREFIX = "@rule:"


# MySQL DATETIME and SQLite's persisted UTC values share this closed range.
# Normalization must happen before hashing so extreme offsets cannot overflow.
MIN_EVENT_OCCURRED_AT_UTC = datetime(1000, 1, 1, tzinfo=UTC)
MAX_EVENT_OCCURRED_AT_UTC = datetime.max.replace(tzinfo=UTC)


def normalize_event_occurred_at(value: datetime) -> datetime:
    """Return a safely normalized UTC event timestamp or raise ValueError."""
    if value.tzinfo is None:
        raise ValueError("occurred_at must include a timezone")
    try:
        if value.utcoffset() is None:
            raise ValueError("occurred_at must include a timezone")
        normalized = value.astimezone(UTC)
    except (OverflowError, ValueError) as exc:
        raise ValueError(
            "occurred_at cannot be represented safely in UTC"
        ) from exc
    if not (
        MIN_EVENT_OCCURRED_AT_UTC
        <= normalized
        <= MAX_EVENT_OCCURRED_AT_UTC
    ):
        raise ValueError(
            "occurred_at must be within UTC years 1000 through 9999"
        )
    return normalized


def learning_evidence_write_gate(dialect_name: str):
    """Serialize only same-process SQLite evidence writers.

    MySQL correctness remains owned by row locks and unique constraints.
    """
    return (
        LEARNING_EVIDENCE_SQLITE_WRITE_LOCK
        if dialect_name == "sqlite"
        else nullcontext()
    )


def as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def canonical_sha256(value: Any) -> str:
    serialized = json.dumps(
        _canonical_value(value),
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def evidence_event_request_sha256(
    *,
    actor_user_id: int,
    subject_user_id: int | None,
    producer_type: str,
    payload: dict,
) -> str:
    return canonical_sha256(
        {
            "actor_user_id": actor_user_id,
            "subject_user_id": subject_user_id,
            "producer_type": producer_type,
            "payload": payload,
        }
    )


def validate_event_occurred_at(
    value: datetime,
    *,
    now: datetime | None = None,
) -> datetime:
    try:
        normalized = normalize_event_occurred_at(value)
    except ValueError as exc:
        fail_learning_evidence(422, "occurred_at_out_of_range", str(exc))
    current = as_utc(now) if now is not None else datetime.now(UTC)
    if normalized > current + MAX_FUTURE_CLOCK_SKEW:
        fail_learning_evidence(
            422,
            "occurred_at_in_future",
            "occurred_at exceeds allowed clock skew",
        )
    return normalized


def fail_learning_evidence(status_code: int, code: str, detail: str):
    raise LearningEvidenceError(status_code, code, detail)


def _canonical_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return as_utc(value).isoformat(timespec="microseconds")
    if isinstance(value, dict):
        return {str(key): _canonical_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_canonical_value(item) for item in value]
    return value
