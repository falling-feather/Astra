from datetime import UTC, datetime
import json
import re
from typing import Annotated, Any, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from app.core.learning_evidence_contract import (
    LEARNING_ACTIVITY_EVIDENCE_SIDECAR_SCHEMA,
    LEARNING_ACTIVITY_EVENT_SCHEMA,
    LEARNING_ACTIVITY_RECOVERY_SCHEMA,
    LEARNING_ACTIVITY_SERVER_RECOVERY_SCHEMA,
    MAX_RULE_WITNESS_EVENTS,
    normalize_event_occurred_at,
)


LearnerEvidenceEventType = Literal["started", "predicted", "attempted", "corrected", "explained"]
DerivedEvidenceEventType = Literal["completed", "transferred"]
DiscoverableEvidenceEventType = Literal[
    "started",
    "predicted",
    "attempted",
    "corrected",
    "explained",
    "completed",
    "transferred",
]
LearningProjectionStatus = Literal["not_started", "in_progress", "completed", "transferred"]
LearningWriteOutcome = Literal["accepted", "duplicate", "rejected", "conflict"]
EvidenceSummaryScalar = str | int | float | bool | None

_ACTIVITY_KEY_PATTERN = re.compile(r"[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*")
_CLIENT_EVENT_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{7,127}")
MAX_EVIDENCE_BYTES = 16_384
MAX_ACTIVITY_SNAPSHOT_BYTES = 65_536
MAX_ACTIVITY_SIDECAR_BYTES = 98_304
_ACTIVITY_OCCURRED_AT_PATTERN = re.compile(
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z"
)
_ACTIVITY_SENSITIVE_FIELDS = frozenset(
    {
        "authorization",
        "cookie",
        "password",
        "token",
        "access_token",
        "refresh_token",
        "subject_identity",
        "subject_user_id",
        "identity_id",
        "authority_generation",
        "completed",
        "transferred",
        "projection_state",
        "authoritative_completion",
    }
)
_LEARNER_EVIDENCE_FIELDS = {
    "started": {"cursor"},
    "predicted": {"prediction", "cursor"},
    "attempted": {"operation", "reported_correct", "cursor"},
    "corrected": {"correction", "cursor"},
    "explained": {"artifact", "cursor"},
}
EvidenceOccurredAt = Annotated[
    datetime,
    AfterValidator(normalize_event_occurred_at),
]


def _bounded_json(value: dict[str, Any], *, field_name: str) -> dict[str, Any]:
    try:
        serialized = json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
        encoded_size = len(serialized.encode("utf-8"))
    except (TypeError, ValueError, UnicodeError) as exc:
        raise ValueError(f"{field_name} must be JSON serializable") from exc
    if encoded_size > MAX_EVIDENCE_BYTES:
        raise ValueError(f"{field_name} exceeds {MAX_EVIDENCE_BYTES} bytes")
    return value


def _activity_key(value: str) -> str:
    normalized = value.strip().lower()
    if len(normalized) > 120 or not _ACTIVITY_KEY_PATTERN.fullmatch(normalized):
        raise ValueError("activity_key must be a stable lowercase segmented key")
    return normalized


def _unicode_scalar_text(value: str, *, field_name: str) -> str:
    try:
        value.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise ValueError(
            f"{field_name} must contain valid Unicode scalar values"
        ) from exc
    return value


def _fact_artifact(
    evidence: dict[str, Any],
    *,
    event_type: str,
    field_name: str,
    max_text_length: int,
) -> dict[str, Any]:
    value = evidence.get(field_name)
    if isinstance(value, str):
        normalized = value.strip()
        if not normalized or len(normalized) > max_text_length:
            raise ValueError(
                f"{event_type}.evidence.{field_name} must be non-empty and at most "
                f"{max_text_length} characters"
            )
        return {**evidence, field_name: normalized}
    if isinstance(value, (dict, list)) and value:
        return evidence
    raise ValueError(
        f"{event_type}.evidence.{field_name} must be a non-empty string, object, or list"
    )


class StrictLearningEvidenceWriteModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StrictLearningActivityModel(BaseModel):
    """Frozen V8 activity transport: no coercion and no unknown fields."""

    model_config = ConfigDict(extra="forbid", strict=True)


def _runtime_token(
    value: str,
    *,
    field_name: str,
    min_length: int = 1,
    max_length: int = 128,
) -> str:
    if value != value.strip() or not (min_length <= len(value) <= max_length):
        raise ValueError(
            f"{field_name} must be canonical and contain {min_length} through "
            f"{max_length} characters"
        )
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]*", value):
        raise ValueError(f"{field_name} must be an opaque ASCII token")
    return value


def _runtime_activity_key(value: str) -> str:
    if (
        value != value.strip()
        or value != value.lower()
        or len(value) > 120
        or not _ACTIVITY_KEY_PATTERN.fullmatch(value)
    ):
        raise ValueError(
            "activity_key must already be a canonical lowercase segmented key"
        )
    return value


def _runtime_occurred_at(value: str) -> str:
    if not isinstance(value, str) or not _ACTIVITY_OCCURRED_AT_PATTERN.fullmatch(
        value
    ):
        raise ValueError(
            "occurred_at must be the exact UTC millisecond form produced by "
            "Date.toISOString()"
        )
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
        normalized = normalize_event_occurred_at(parsed)
    except ValueError as exc:
        raise ValueError("occurred_at is not a valid canonical UTC timestamp") from exc
    if (
        normalized.astimezone(UTC)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
        != value
    ):
        raise ValueError("occurred_at must be canonical UTC without normalization")
    return value


def _reject_activity_sensitive_data(value: Any, *, field_name: str) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            normalized_key = str(key).lower()
            if normalized_key in _ACTIVITY_SENSITIVE_FIELDS:
                raise ValueError(
                    f"{field_name} contains forbidden sensitive field {key}"
                )
            _reject_activity_sensitive_data(
                item,
                field_name=f"{field_name}.{key}",
            )
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _reject_activity_sensitive_data(
                item,
                field_name=f"{field_name}[{index}]",
            )


class LearningActivitySubjectIdentity(StrictLearningActivityModel):
    kind: Literal["learner"]
    id: str = Field(min_length=1, max_length=128)

    @field_validator("id")
    @classmethod
    def validate_identity_id(cls, value: str) -> str:
        return _runtime_token(value, field_name="subject_identity.id")


class LearningActivityRuntimeScope(StrictLearningActivityModel):
    class_id: int = Field(ge=1)
    course_id: int = Field(ge=1)
    course_unit_id: int = Field(ge=1)
    activity_key: str = Field(min_length=1, max_length=120)

    @field_validator("activity_key")
    @classmethod
    def validate_activity_key(cls, value: str) -> str:
        return _runtime_activity_key(value)


class LearningActivityRuntimeRun(StrictLearningActivityModel):
    run_id: str = Field(min_length=8, max_length=128)
    group_id: str = Field(min_length=8, max_length=128)
    sequence: int = Field(ge=1)

    @field_validator("run_id", "group_id")
    @classmethod
    def validate_run_token(cls, value: str, info) -> str:
        return _runtime_token(
            value,
            field_name=info.field_name,
            min_length=8,
        )


class LearningActivityRuntimeVersions(StrictLearningActivityModel):
    manifest_version: str = Field(min_length=1, max_length=64)
    content_version: str = Field(min_length=1, max_length=64)
    event_schema_version: int = Field(ge=1)
    rule_version: int = Field(ge=1)
    generation: str = Field(min_length=1, max_length=128)

    @field_validator("manifest_version", "content_version", "generation")
    @classmethod
    def validate_version_token(cls, value: str, info) -> str:
        return _runtime_token(value, field_name=info.field_name)


class LearningActivityRuntimeIdentity(StrictLearningActivityModel):
    class_id: int = Field(ge=1)
    course_id: int = Field(ge=1)
    course_unit_id: int = Field(ge=1)
    activity_key: str = Field(min_length=1, max_length=120)
    subject_identity: LearningActivitySubjectIdentity
    run_id: str = Field(min_length=8, max_length=128)
    group_id: str = Field(min_length=8, max_length=128)
    manifest_version: str = Field(min_length=1, max_length=64)
    content_version: str = Field(min_length=1, max_length=64)
    event_schema_version: int = Field(ge=1)
    rule_version: int = Field(ge=1)
    generation: str = Field(min_length=1, max_length=128)

    @field_validator("activity_key")
    @classmethod
    def validate_identity_activity_key(cls, value: str) -> str:
        return _runtime_activity_key(value)

    @field_validator(
        "run_id",
        "group_id",
        "manifest_version",
        "content_version",
        "generation",
    )
    @classmethod
    def validate_identity_token(cls, value: str, info) -> str:
        return _runtime_token(
            value,
            field_name=info.field_name,
            min_length=8 if info.field_name in {"run_id", "group_id"} else 1,
        )


class LearningActivityAuthorityRead(StrictLearningActivityModel):
    authorized: Literal[True]
    identity: LearningActivityRuntimeIdentity
    revision: str = Field(min_length=8, max_length=64)


class LearningActivityReleaseRead(StrictLearningActivityModel):
    scope: LearningActivityRuntimeScope
    state: Literal["hidden", "locked", "open"]
    revision: str = Field(min_length=8, max_length=64)


class LearningActivityRuntimeSnapshotWrite(StrictLearningActivityModel):
    state_schema_version: str = Field(min_length=1, max_length=64)
    applied_through_learner_sequence: int = Field(ge=1)
    data: dict[str, Any] = Field(default_factory=dict)

    @field_validator("state_schema_version")
    @classmethod
    def validate_state_schema_version(cls, value: str) -> str:
        return _runtime_token(value, field_name="state_schema_version")

    @field_validator("data")
    @classmethod
    def validate_snapshot_size(cls, value: dict[str, Any]) -> dict[str, Any]:
        _reject_activity_sensitive_data(value, field_name="snapshot.data")
        try:
            serialized = json.dumps(
                value,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
                allow_nan=False,
            )
        except (TypeError, ValueError, UnicodeError) as exc:
            raise ValueError("snapshot.data must be JSON serializable") from exc
        if len(serialized.encode("utf-8")) > MAX_ACTIVITY_SNAPSHOT_BYTES:
            raise ValueError(
                f"snapshot.data exceeds {MAX_ACTIVITY_SNAPSHOT_BYTES} bytes"
            )
        return value


class LearningActivityRuntimeCommand(StrictLearningActivityModel):
    schema_version: Literal[LEARNING_ACTIVITY_EVENT_SCHEMA]
    scope: LearningActivityRuntimeScope
    run: LearningActivityRuntimeRun
    versions: LearningActivityRuntimeVersions
    client_event_id: str = Field(min_length=8, max_length=128)
    event_type: LearnerEvidenceEventType
    evidence: dict[str, Any] = Field(default_factory=dict)
    occurred_at: str

    @field_validator("client_event_id")
    @classmethod
    def validate_client_event_id(cls, value: str) -> str:
        if not _CLIENT_EVENT_ID_PATTERN.fullmatch(value):
            raise ValueError("client_event_id must be an opaque stable identifier")
        return value

    @field_validator("evidence")
    @classmethod
    def validate_evidence_size(cls, value: dict[str, Any]) -> dict[str, Any]:
        _reject_activity_sensitive_data(value, field_name="command.evidence")
        return _bounded_json(value, field_name="evidence")

    @field_validator("occurred_at")
    @classmethod
    def validate_occurred_at(cls, value: str) -> str:
        return _runtime_occurred_at(value)

    @model_validator(mode="after")
    def validate_runtime_fact_payload(self):
        legacy_shape = LearnerEvidenceEventCreate.model_validate(
            {
                "client_event_id": self.client_event_id,
                "class_id": self.scope.class_id,
                "course_id": self.scope.course_id,
                "course_unit_id": self.scope.course_unit_id,
                "activity_key": self.scope.activity_key,
                "rule_version": self.versions.rule_version,
                "event_type": self.event_type,
                "evidence": self.evidence,
                "occurred_at": datetime.fromisoformat(
                    self.occurred_at[:-1] + "+00:00"
                ),
            }
        )
        if legacy_shape.evidence != self.evidence:
            raise ValueError(
                "command.evidence must already use the canonical learner fact form"
            )
        return self


class LearningActivityRuntimeEventCreate(StrictLearningActivityModel):
    """One immutable EvidencePort sidecar accepted atomically by the server."""

    schema_version: Literal[LEARNING_ACTIVITY_EVIDENCE_SIDECAR_SCHEMA]
    command: LearningActivityRuntimeCommand
    snapshot: LearningActivityRuntimeSnapshotWrite

    @model_validator(mode="after")
    def validate_sidecar(self):
        if (
            self.snapshot.applied_through_learner_sequence
            != self.command.run.sequence
        ):
            raise ValueError(
                "snapshot.applied_through_learner_sequence must equal "
                "command.run.sequence"
            )
        serialized = json.dumps(
            self.model_dump(mode="json"),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
        if len(serialized.encode("utf-8")) > MAX_ACTIVITY_SIDECAR_BYTES:
            raise ValueError(
                f"activity sidecar exceeds {MAX_ACTIVITY_SIDECAR_BYTES} bytes"
            )
        return self


class LearningActivityRuntimeReceipt(StrictLearningActivityModel):
    status: Literal[
        "confirmed",
        "reconciled",
        "local-pending",
        "manual-intervention",
    ]
    client_event_id: str
    event_type: LearnerEvidenceEventType
    run_id: str
    group_id: str
    learner_sequence: int = Field(ge=1)
    server_sequence: int | None = Field(default=None, ge=1)
    server_last_sequence: int | None = Field(default=None, ge=1)
    server_event_id: str | None = None

    @field_validator("client_event_id", "run_id", "group_id", "server_event_id")
    @classmethod
    def validate_receipt_tokens(cls, value: str | None, info) -> str | None:
        if value is None:
            return None
        return _runtime_token(
            value,
            field_name=info.field_name,
            min_length=8,
        )

    @model_validator(mode="after")
    def validate_receipt_authority(self):
        authoritative = self.status in {"confirmed", "reconciled"}
        server_values = (
            self.server_sequence,
            self.server_last_sequence,
            self.server_event_id,
        )
        if authoritative:
            if any(value is None for value in server_values):
                raise ValueError("authoritative receipt requires all server fields")
            if self.server_last_sequence < self.server_sequence:
                raise ValueError(
                    "server_last_sequence must include the accepted server position"
                )
        elif any(value is not None for value in server_values):
            raise ValueError(
                "non-authoritative receipt must leave all server fields null"
            )
        return self


class LearningActivityServerLearnerEventRead(StrictLearningActivityModel):
    identity: LearningActivityRuntimeIdentity
    server_sequence: int = Field(ge=1)
    server_event_id: str = Field(min_length=8, max_length=128)
    learner_sequence: int = Field(ge=1)
    event_type: LearnerEvidenceEventType
    producer: Literal["learner"]
    occurred_at: str
    sidecar: LearningActivityRuntimeEventCreate

    @field_validator("occurred_at")
    @classmethod
    def validate_learner_occurred_at(cls, value: str) -> str:
        return _runtime_occurred_at(value)


class LearningActivityServerDerivedEventRead(StrictLearningActivityModel):
    identity: LearningActivityRuntimeIdentity
    server_sequence: int = Field(ge=1)
    server_event_id: str = Field(min_length=8, max_length=128)
    learner_sequence: None = None
    event_type: DerivedEvidenceEventType
    producer: Literal["server"]
    occurred_at: str
    evidence: dict[str, Any]

    @field_validator("occurred_at")
    @classmethod
    def validate_derived_occurred_at(cls, value: str) -> str:
        return _runtime_occurred_at(value)


LearningActivityServerEventRead = Annotated[
    LearningActivityServerLearnerEventRead | LearningActivityServerDerivedEventRead,
    Field(discriminator="producer"),
]


class LearningActivityCompletionWitnessRead(StrictLearningActivityModel):
    identity: LearningActivityRuntimeIdentity
    projection_state: Literal["completed", "transferred"]
    rule_version: int = Field(ge=1)
    applied_through_server_sequence: int = Field(ge=1)
    derived_server_event_id: str = Field(min_length=8, max_length=128)
    derived_server_sequence: int = Field(ge=1)
    source_client_event_ids: list[str] = Field(min_length=1, max_length=MAX_RULE_WITNESS_EVENTS)

    @field_validator("source_client_event_ids")
    @classmethod
    def validate_source_client_event_ids(cls, values: list[str]) -> list[str]:
        if len(values) != len(set(values)):
            raise ValueError("completion source client_event_id values must be unique")
        return [
            _runtime_token(
                value,
                field_name="source_client_event_ids",
                min_length=8,
            )
            for value in values
        ]


class LearningActivityServerProjectionRead(StrictLearningActivityModel):
    state: LearningProjectionStatus
    applied_through_server_sequence: int = Field(ge=0)
    completion_witness: LearningActivityCompletionWitnessRead | None = None

    @model_validator(mode="after")
    def validate_terminal_witness(self):
        terminal = self.state in {"completed", "transferred"}
        if terminal != (self.completion_witness is not None):
            raise ValueError(
                "terminal server projection requires exactly one completion witness"
            )
        if self.completion_witness is not None and (
            self.completion_witness.projection_state != self.state
            or self.completion_witness.applied_through_server_sequence
            != self.applied_through_server_sequence
        ):
            raise ValueError("completion witness does not match server projection")
        return self


class LearningActivityServerSnapshotRead(StrictLearningActivityModel):
    identity: LearningActivityRuntimeIdentity
    state_schema_version: str
    applied_through_learner_sequence: int = Field(ge=0)
    data: dict[str, Any]

    @field_validator("state_schema_version")
    @classmethod
    def validate_snapshot_schema(cls, value: str) -> str:
        return _runtime_token(value, field_name="state_schema_version")

    @field_validator("data")
    @classmethod
    def validate_snapshot_data(cls, value: dict[str, Any]) -> dict[str, Any]:
        _reject_activity_sensitive_data(value, field_name="server.snapshot.data")
        return value


class LearningActivityServerHistoryRead(StrictLearningActivityModel):
    identity: LearningActivityRuntimeIdentity
    complete_history: Literal[True]
    event_count: int = Field(ge=0)
    events: list[LearningActivityServerEventRead]
    projection: LearningActivityServerProjectionRead
    snapshot: LearningActivityServerSnapshotRead | None

    @model_validator(mode="after")
    def validate_server_half(self):
        if self.event_count != len(self.events):
            raise ValueError("server.event_count must equal the returned ledger size")
        if [event.server_sequence for event in self.events] != list(
            range(1, self.event_count + 1)
        ):
            raise ValueError("server history must be contiguous by server_sequence")
        learner_events = [
            event
            for event in self.events
            if isinstance(event, LearningActivityServerLearnerEventRead)
        ]
        if [event.learner_sequence for event in learner_events] != list(
            range(1, len(learner_events) + 1)
        ):
            raise ValueError("learner history must be contiguous by learner_sequence")
        if any(event.identity != self.identity for event in self.events):
            raise ValueError("server event identity does not match its container")
        if self.projection.applied_through_server_sequence != self.event_count:
            raise ValueError("server snapshot or projection cursor is incomplete")
        if not learner_events:
            if (
                self.event_count != 0
                or self.snapshot is not None
                or self.projection.state != "not_started"
                or self.projection.completion_witness is not None
            ):
                raise ValueError(
                    "empty server ledger requires an explicit external initial snapshot"
                )
            return self
        if self.snapshot is None or self.snapshot.identity != self.identity:
            raise ValueError("server snapshot identity does not match its container")
        if self.snapshot.applied_through_learner_sequence != len(learner_events):
            raise ValueError("server snapshot learner cursor is incomplete")
        if learner_events:
            latest_snapshot = learner_events[-1].sidecar.snapshot
            if (
                self.snapshot.state_schema_version
                != latest_snapshot.state_schema_version
                or self.snapshot.applied_through_learner_sequence
                != latest_snapshot.applied_through_learner_sequence
                or self.snapshot.data != latest_snapshot.data
            ):
                raise ValueError(
                    "server snapshot must equal the last accepted learner sidecar"
                )
        witness = self.projection.completion_witness
        if witness is not None:
            if witness.identity != self.identity:
                raise ValueError("completion witness identity mismatch")
            derived = next(
                (
                    event
                    for event in self.events
                    if event.server_event_id == witness.derived_server_event_id
                    and event.server_sequence == witness.derived_server_sequence
                ),
                None,
            )
            by_client_id = {
                event.sidecar.command.client_event_id: event
                for event in learner_events
            }
            sources = [
                by_client_id.get(client_event_id)
                for client_event_id in witness.source_client_event_ids
            ]
            if (
                not isinstance(derived, LearningActivityServerDerivedEventRead)
                or derived.event_type != witness.projection_state
                or any(source is None for source in sources)
                or any(
                    source.server_sequence >= derived.server_sequence
                    for source in sources
                )
            ):
                raise ValueError("completion witness is not causally proven")
        return self


class LearningActivityInitialSnapshotRequirementRead(StrictLearningActivityModel):
    source: Literal["owner-adapter-canonical-initial-snapshot"]
    state_schema_version_source: Literal[
        "manifest.content.state_schema_version"
    ]
    applied_through_learner_sequence: Literal[0] = 0
    server_domain_state_verified: Literal[False] = False


class LearningActivityRecoveryFreshnessRead(StrictLearningActivityModel):
    status: Literal["current"]
    authority_revision: str
    release_revision: str

    @field_validator("authority_revision", "release_revision")
    @classmethod
    def validate_revision(cls, value: str, info) -> str:
        return _runtime_token(
            value,
            field_name=info.field_name,
            min_length=8,
            max_length=64,
        )


class LearningActivityServerRecoveryRead(StrictLearningActivityModel):
    schema_version: Literal[LEARNING_ACTIVITY_SERVER_RECOVERY_SCHEMA]
    consumer_schema_version: Literal[LEARNING_ACTIVITY_RECOVERY_SCHEMA]
    exact_available: bool
    manual_intervention_required: bool
    reason: str | None = None
    snapshot_id: str | None = None
    captured_at: str
    identity: LearningActivityRuntimeIdentity
    freshness: LearningActivityRecoveryFreshnessRead | None = None
    server: LearningActivityServerHistoryRead | None = None
    initial_snapshot_requirement: (
        LearningActivityInitialSnapshotRequirementRead | None
    ) = None
    client_pending_status: Literal["unknown"] = "unknown"

    @field_validator("captured_at")
    @classmethod
    def validate_captured_at(cls, value: str) -> str:
        return _runtime_occurred_at(value)

    @field_validator("snapshot_id")
    @classmethod
    def validate_snapshot_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _runtime_token(
            value,
            field_name="snapshot_id",
            min_length=8,
        )

    @model_validator(mode="after")
    def validate_server_half_availability(self):
        if self.exact_available:
            if (
                self.manual_intervention_required
                or self.reason is not None
                or self.snapshot_id is None
                or self.freshness is None
                or self.server is None
            ):
                raise ValueError("exact server half is missing authoritative fields")
            if self.server.identity != self.identity:
                raise ValueError("server half identity mismatch")
            empty_ledger = self.server.event_count == 0
            if empty_ledger != (self.initial_snapshot_requirement is not None):
                raise ValueError(
                    "only an empty ledger requires owner-adapter initial snapshot assembly"
                )
        elif (
            self.snapshot_id is not None
            or self.freshness is not None
            or self.server is not None
            or self.initial_snapshot_requirement is not None
            or self.reason is None
        ):
            raise ValueError("unavailable server half must not expose partial history")
        return self


class CompletionActivityRule(StrictLearningEvidenceWriteModel):
    activity_key: str = Field(min_length=1, max_length=120)
    outcome: DerivedEvidenceEventType = "completed"
    required_event_types: list[LearnerEvidenceEventType] = Field(default_factory=list, max_length=5)
    minimum_attempts: int = Field(
        default=0,
        ge=0,
        le=MAX_RULE_WITNESS_EVENTS,
    )
    minimum_correct_attempts: int = Field(
        default=0,
        ge=0,
        le=MAX_RULE_WITNESS_EVENTS,
    )

    @field_validator("activity_key")
    @classmethod
    def normalize_activity_key(cls, value: str) -> str:
        return _activity_key(value)

    @field_validator("required_event_types")
    @classmethod
    def unique_required_event_types(cls, values: list[str]) -> list[str]:
        if len(values) != len(set(values)):
            raise ValueError("required_event_types must be unique")
        return sorted(values)

    @model_validator(mode="after")
    def require_observable_criterion(self):
        if not self.required_event_types and self.minimum_attempts == 0 and self.minimum_correct_attempts == 0:
            raise ValueError("an activity rule must require at least one observable learner fact")
        if self.minimum_correct_attempts > self.minimum_attempts:
            raise ValueError(
                "minimum_correct_attempts must not exceed minimum_attempts"
            )
        if self.minimum_correct_attempts > 0:
            raise ValueError(
                "minimum_correct_attempts is unavailable for learner facts; "
                "authoritative correctness requires trusted assessment"
            )
        required_types = set(self.required_event_types)
        minimum_witness_size = (
            len(required_types - {"attempted"})
            + max(
                self.minimum_attempts,
                1 if "attempted" in required_types else 0,
            )
        )
        if minimum_witness_size > MAX_RULE_WITNESS_EVENTS:
            raise ValueError(
                "an activity rule witness must contain at most "
                f"{MAX_RULE_WITNESS_EVENTS} learner facts"
            )
        if self.outcome == "completed":
            evidence_types = set(required_types)
            if self.minimum_attempts > 0:
                evidence_types.add("attempted")
            repeated_attempt_evidence = self.minimum_attempts >= 2
            if len(evidence_types) < 2 and not repeated_attempt_evidence:
                raise ValueError(
                    "completed rules require multiple fact types or at least two attempts"
                )
        if (
            self.outcome == "transferred"
            and "explained" not in self.required_event_types
        ):
            raise ValueError(
                "transferred rules require an explained artifact"
            )
        return self


class CompletionRuleCreate(StrictLearningEvidenceWriteModel):
    course_id: int = Field(ge=1)
    activities: list[CompletionActivityRule] = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def unique_activity_rules(self):
        keys = [activity.activity_key for activity in self.activities]
        if len(keys) != len(set(keys)):
            raise ValueError("activities must contain one rule per activity_key")
        return self


class CompletionRuleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    course_id: int
    version_number: int
    status: Literal["draft", "active"]
    schema_version: int = Field(ge=1)
    activities: list[CompletionActivityRule]
    definition_sha256: str
    created_by_user_id: int
    activated_by_user_id: int | None = None
    activated_at: datetime | None = None
    created_at: datetime


class RuleClassBindingCreate(StrictLearningEvidenceWriteModel):
    class_id: int = Field(ge=1)
    expected_plan_version: int = Field(ge=1)


class CompletionRuleActivate(StrictLearningEvidenceWriteModel):
    expected_revision: int = Field(ge=0)
    class_bindings: list[RuleClassBindingCreate] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def unique_class_bindings(self):
        class_ids = [binding.class_id for binding in self.class_bindings]
        if len(class_ids) != len(set(class_ids)):
            raise ValueError("class_bindings must contain one row per class")
        return self


class RuleClassBindingRead(BaseModel):
    class_id: int
    course_class_id: int
    plan_version: int
    rule_id: int
    rule_version: int


class CompletionRuleActivationRead(BaseModel):
    course_id: int
    rule: CompletionRuleRead
    revision: int
    changed: bool
    bindings: list[RuleClassBindingRead]


class EffectiveRuleClassBindingRead(BaseModel):
    class_id: int
    course_class_id: int
    plan_version: int
    binding_plan_version: int | None = None
    rule_id: int | None = None
    rule_version: int | None = None


class CompletionRuleActivationStateRead(BaseModel):
    course_id: int
    revision: int = Field(ge=0)
    active_rule: CompletionRuleRead | None = None
    bindings: list[EffectiveRuleClassBindingRead]


class LearnerEvidenceEventCreate(StrictLearningEvidenceWriteModel):
    client_event_id: str = Field(min_length=8, max_length=128)
    class_id: int = Field(ge=1)
    course_id: int = Field(ge=1)
    course_unit_id: int = Field(ge=1)
    assignment_id: int | None = Field(default=None, ge=1)
    activity_key: str = Field(min_length=1, max_length=120)
    rule_version: int = Field(ge=1)
    event_type: LearnerEvidenceEventType
    evidence: dict[str, Any] = Field(default_factory=dict)
    occurred_at: EvidenceOccurredAt

    @field_validator("client_event_id")
    @classmethod
    def validate_client_event_id(cls, value: str) -> str:
        if not _CLIENT_EVENT_ID_PATTERN.fullmatch(value):
            raise ValueError("client_event_id must be an opaque stable identifier")
        return value

    @field_validator("activity_key")
    @classmethod
    def normalize_activity_key(cls, value: str) -> str:
        return _activity_key(value)

    @field_validator("evidence")
    @classmethod
    def validate_evidence_size(cls, value: dict[str, Any]) -> dict[str, Any]:
        return _bounded_json(value, field_name="evidence")

    @model_validator(mode="after")
    def validate_fact_payload(self):
        unknown_fields = set(self.evidence) - _LEARNER_EVIDENCE_FIELDS[self.event_type]
        if unknown_fields:
            raise ValueError(
                f"{self.event_type}.evidence contains unsupported fields: "
                f"{', '.join(sorted(unknown_fields))}"
            )
        if "cursor" in self.evidence:
            cursor = self.evidence["cursor"]
            if not isinstance(cursor, dict) or not cursor:
                raise ValueError("evidence.cursor must be a non-empty object")
        if self.event_type == "predicted":
            self.evidence = _fact_artifact(
                self.evidence,
                event_type="predicted",
                field_name="prediction",
                max_text_length=2_000,
            )
        if self.event_type == "attempted":
            operation = self.evidence.get("operation")
            if not isinstance(operation, str) or not operation.strip() or len(operation.strip()) > 80:
                raise ValueError("attempted.evidence.operation is required and must be at most 80 characters")
            if "correct" in self.evidence:
                raise ValueError(
                    "attempted.evidence.correct is ambiguous; use reported_correct"
                )
            reported_correct = self.evidence.get("reported_correct")
            if reported_correct is not None and not isinstance(reported_correct, bool):
                raise ValueError("attempted.evidence.reported_correct must be boolean")
            self.evidence = {
                **self.evidence,
                "operation": operation.strip(),
            }
        if self.event_type == "corrected":
            self.evidence = _fact_artifact(
                self.evidence,
                event_type="corrected",
                field_name="correction",
                max_text_length=4_000,
            )
        if self.event_type == "explained":
            self.evidence = _fact_artifact(
                self.evidence,
                event_type="explained",
                field_name="artifact",
                max_text_length=8_000,
            )
        return self


class TrustedAssessmentEvidenceCreate(StrictLearningEvidenceWriteModel):
    client_event_id: str = Field(min_length=8, max_length=128)
    subject_user_id: int = Field(ge=1)
    class_id: int = Field(ge=1)
    course_id: int = Field(ge=1)
    course_unit_id: int = Field(ge=1)
    activity_key: str = Field(min_length=1, max_length=120)
    rule_version: int = Field(ge=1)
    outcome: DerivedEvidenceEventType
    source_ref: str = Field(min_length=1, max_length=256)
    occurred_at: EvidenceOccurredAt
    evidence: dict[str, Any] = Field(default_factory=dict)

    @field_validator("client_event_id")
    @classmethod
    def validate_client_event_id(cls, value: str) -> str:
        if not _CLIENT_EVENT_ID_PATTERN.fullmatch(value):
            raise ValueError("client_event_id must be an opaque stable identifier")
        return value

    @field_validator("activity_key")
    @classmethod
    def normalize_activity_key(cls, value: str) -> str:
        return _activity_key(value)

    @field_validator("source_ref")
    @classmethod
    def normalize_source_ref(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("source_ref must not be blank")
        return _unicode_scalar_text(normalized, field_name="source_ref")

    @field_validator("evidence")
    @classmethod
    def validate_evidence(cls, value: dict[str, Any]) -> dict[str, Any]:
        if "source_ref" in value:
            raise ValueError("evidence.source_ref is reserved")
        return _bounded_json(value, field_name="evidence")


class LearningEvidenceReceipt(BaseModel):
    event_id: int
    client_event_id: str
    event_type: str
    outcome: LearningWriteOutcome
    received_at: datetime


class LearnerEvidenceBatchCreate(StrictLearningEvidenceWriteModel):
    items: list[LearnerEvidenceEventCreate] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def unique_client_event_ids(self):
        keys = [item.client_event_id for item in self.items]
        if len(keys) != len(set(keys)):
            raise ValueError("batch client_event_id values must be unique")
        return self


class LearningEvidenceBatchItemResult(BaseModel):
    client_event_id: str
    outcome: LearningWriteOutcome
    receipt: LearningEvidenceReceipt | None = None
    status_code: int
    error_code: str | None = None
    detail: str | None = None


class LearningEvidenceBatchRead(BaseModel):
    items: list[LearningEvidenceBatchItemResult]
    accepted_count: int
    duplicate_count: int
    rejected_count: int
    conflict_count: int


class TeacherEvidenceCorrectionCreate(StrictLearningEvidenceWriteModel):
    client_event_id: str = Field(min_length=8, max_length=128)
    reason: str = Field(min_length=1, max_length=1000)
    occurred_at: EvidenceOccurredAt

    @field_validator("client_event_id")
    @classmethod
    def validate_client_event_id(cls, value: str) -> str:
        if not _CLIENT_EVENT_ID_PATTERN.fullmatch(value):
            raise ValueError("client_event_id must be an opaque stable identifier")
        return value

    @field_validator("reason")
    @classmethod
    def validate_reason(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("reason must not be blank")
        if len(normalized) > 1000:
            raise ValueError("reason must contain at most 1000 characters")
        return _unicode_scalar_text(normalized, field_name="reason")


class LearningEvidenceSummaryRead(BaseModel):
    facts: dict[str, EvidenceSummaryScalar] = Field(default_factory=dict, max_length=12)
    truncated: bool = False


class TeacherLearningEvidenceEventRead(BaseModel):
    event_id: int
    subject_user_id: int
    course_unit_id: int
    assignment_id: int | None = None
    activity_key: str
    event_type: DiscoverableEvidenceEventType
    producer_type: Literal["learner", "trusted_assessment"]
    occurred_at: datetime
    evidence_summary: LearningEvidenceSummaryRead
    corrects_event_id: int | None = None
    corrected_by_event_id: int | None = None


class TeacherLearningEvidencePageRead(BaseModel):
    class_id: int
    course_id: int
    subject_user_id: int
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)
    offset: int = Field(ge=0, le=100_000)
    next_offset: int | None = Field(default=None, ge=0)
    items: list[TeacherLearningEvidenceEventRead]


class LearningActivityProjectionRead(BaseModel):
    course_unit_id: int
    activity_key: str
    rule_version: int
    status: LearningProjectionStatus
    learner_event_count: int
    attempt_count: int
    reported_correct_attempt_count: int
    corrected_count: int
    explained_count: int
    first_started_at: datetime | None = None
    last_occurred_at: datetime | None = None
    completed_at: datetime | None = None
    transferred_at: datetime | None = None
    resume_cursor: dict[str, Any] = Field(default_factory=dict)


class LearningResumeCursorRead(BaseModel):
    course_unit_id: int
    activity_key: str
    rule_version: int
    last_event_id: int
    last_occurred_at: datetime
    cursor: dict[str, Any] = Field(default_factory=dict)


class StudentLearningRecoveryRead(BaseModel):
    subject_user_id: int
    class_id: int
    course_id: int
    rule_version: int
    resume: LearningResumeCursorRead | None = None
    activities: list[LearningActivityProjectionRead]


class TeacherActivityAggregateRead(BaseModel):
    course_unit_id: int
    activity_key: str
    not_started: int
    in_progress: int
    completed: int
    transferred: int
    active_students: int
    completion_percent: float


class TeacherLearningAggregateRead(BaseModel):
    class_id: int
    course_id: int
    rule_version: int
    active_students: int
    generated_at: datetime
    activities: list[TeacherActivityAggregateRead]


class ProjectionRebuildRead(BaseModel):
    class_id: int
    course_id: int
    subject_user_id: int | None = None
    rebuilt_activities: int
    rebuilt_resume_projections: int


class LegacyAccessEntitlementRead(BaseModel):
    id: int
    subject_user_id: int
    class_id: int
    prerequisite_unit_id: int
    source_learning_event_id: int | None = None
    source_event_kind: str
    migration_revision: str
    created_at: datetime
