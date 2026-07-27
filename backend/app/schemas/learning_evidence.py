from datetime import datetime
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
    MAX_RULE_WITNESS_EVENTS,
    normalize_event_occurred_at,
)


LearnerEvidenceEventType = Literal["started", "predicted", "attempted", "corrected", "explained"]
DerivedEvidenceEventType = Literal["completed", "transferred"]
LearningProjectionStatus = Literal["not_started", "in_progress", "completed", "transferred"]
LearningWriteOutcome = Literal["accepted", "duplicate", "rejected", "conflict"]

_ACTIVITY_KEY_PATTERN = re.compile(r"[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*")
_CLIENT_EVENT_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{7,127}")
MAX_EVIDENCE_BYTES = 16_384
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
