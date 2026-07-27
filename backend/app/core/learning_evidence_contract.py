"""Shared, dependency-free limits for the learning-evidence v1 contract."""

from datetime import UTC, datetime


# A rule may require at most this many learner facts for one derived outcome.
# This is intentionally a teaching-scale bound: larger automated evaluations
# must enter through the trusted-assessment contract instead of expanding an
# append-only rule witness.
MAX_RULE_WITNESS_EVENTS = 100


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
