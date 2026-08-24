from datetime import datetime
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.school import ClassRead

CourseStatus = Literal["draft", "published", "archived"]
UnitStatus = Literal["draft", "published", "archived"]
AssignmentStatus = Literal["active", "closed", "archived"]
AssignmentAudienceMode = Literal["all_attached_classes", "selected_classes"]
SubmissionStatus = Literal["submitted", "graded", "returned"]
SubmissionGradeStatus = Literal["graded", "returned"]
LearningEventType = Literal["visit", "start", "submit", "complete"]
AssignmentPointRuleSource = Literal["default", "custom", "class_override"]
CourseCollaboratorRole = Literal["editor", "content_editor", "assessment_editor", "viewer"]
CourseCollaboratorStatus = Literal["active", "inactive"]
StudentAssignmentFilter = Literal["all", "active", "feedback", "history"]
ReleaseMode = Literal["hidden", "locked", "open"]
EffectiveReleaseState = Literal["hidden", "locked", "open"]

def _normalize_stable_key(
    value: str,
    *,
    field_name: str,
    max_length: int,
    allow_periods: bool = False,
) -> str:
    normalized = re.sub(r"[\s_]+", "-", value.strip().lower())
    normalized = re.sub(r"-+", "-", normalized).strip("-")
    pattern = (
        r"[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*"
        if allow_periods
        else r"[a-z0-9][a-z0-9-]*"
    )
    if not normalized or len(normalized) > max_length or not re.fullmatch(pattern, normalized):
        raise ValueError(
            f"{field_name} must contain lowercase letters, digits, and hyphens, start with a letter or digit, and fit its length limit"
        )
    return normalized


class CourseCreate(BaseModel):
    school_id: int
    galaxy_key: str | None = Field(default=None, min_length=1, max_length=32)
    subject_key: str | None = Field(default=None, min_length=1, max_length=96)
    course_key: str | None = Field(default=None, min_length=1, max_length=96)
    title: str = Field(min_length=1, max_length=180)
    summary: str | None = Field(default=None, max_length=2000)
    status: CourseStatus = "draft"

    @field_validator("galaxy_key")
    @classmethod
    def normalize_galaxy_key(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _normalize_stable_key(value, field_name="galaxy_key", max_length=32)

    @field_validator("subject_key", "course_key")
    @classmethod
    def normalize_subject_or_course_key(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _normalize_stable_key(value, field_name="subject_key/course_key", max_length=96)


class CourseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    school_id: int
    creator_user_id: int
    galaxy_key: str
    subject_key: str
    course_key: str
    title: str
    summary: str | None = None
    status: str


class CourseClassAttach(BaseModel):
    class_id: int


class CourseClassRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    course_id: int
    class_id: int
    status: str
    plan_version: int


class CourseCollaboratorCreate(BaseModel):
    user_id: int
    role: CourseCollaboratorRole = "editor"


class CourseCollaboratorUpdate(BaseModel):
    role: CourseCollaboratorRole | None = None
    status: CourseCollaboratorStatus | None = None


class CourseCollaboratorRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    course_id: int
    user_id: int
    role: str
    status: str


class CourseCollaboratorBatchItem(BaseModel):
    user_id: int
    role: CourseCollaboratorRole = "editor"
    status: CourseCollaboratorStatus = "active"
    client_ref: str | None = Field(default=None, max_length=64)


class CourseCollaboratorBatchUpdate(BaseModel):
    items: list[CourseCollaboratorBatchItem] = Field(min_length=1, max_length=100)


class CourseCollaboratorBatchResult(BaseModel):
    user_id: int
    client_ref: str | None = None
    outcome: Literal["created", "updated", "unchanged", "failed"]
    collaborator: CourseCollaboratorRead | None = None
    error_code: Literal[
        "duplicate_item",
        "collaborator_not_eligible",
        "course_owner_conflict",
        "collaborator_not_found",
    ] | None = None


class CourseCollaboratorBatchRead(BaseModel):
    items: list[CourseCollaboratorBatchResult]
    created_count: int
    updated_count: int
    unchanged_count: int
    failed_count: int


class CourseOwnerTransfer(BaseModel):
    target_user_id: int


class CourseUnitCreate(BaseModel):
    activity_key: str | None = Field(default=None, min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=180)
    position: int = Field(ge=1)
    content_slug: str | None = Field(default=None, max_length=180)
    status: UnitStatus = "published"

    @field_validator("activity_key")
    @classmethod
    def normalize_activity_key(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _normalize_stable_key(
            value,
            field_name="activity_key",
            max_length=120,
            allow_periods=True,
        )


class CourseUnitRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    course_id: int
    activity_key: str
    title: str
    position: int
    content_slug: str | None = None
    status: str
    effective_release_state: EffectiveReleaseState | None = None
    lock_reasons: list[str] = Field(default_factory=list)


class CourseReleasePlanPatchItem(BaseModel):
    course_unit_id: int
    position: int | None = Field(default=None, ge=1)
    release_mode: ReleaseMode | None = None
    open_at: datetime | None = None
    prerequisite_unit_id: int | None = None


class CourseReleasePlanPatch(BaseModel):
    expected_version: int = Field(ge=1)
    items: list[CourseReleasePlanPatchItem] = Field(min_length=1, max_length=100)
    reason: str | None = Field(default=None, max_length=4000)


class CourseReleasePlanItemRead(BaseModel):
    id: int
    course_unit_id: int
    activity_key: str
    position: int
    release_mode: ReleaseMode
    open_at: datetime | None = None
    prerequisite_unit_id: int | None = None
    effective_release_state: EffectiveReleaseState
    lock_reasons: list[str] = Field(default_factory=list)


class CourseReleasePlanRead(BaseModel):
    course_id: int
    class_id: int
    course_class_id: int
    plan_version: int
    changed: bool = False
    items: list[CourseReleasePlanItemRead]


class AssignmentCreate(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=4000)
    due_at: datetime | None = None
    max_score: int = Field(default=100, ge=0, le=1000)
    status: AssignmentStatus = "active"
    audience_mode: AssignmentAudienceMode = "all_attached_classes"


class AssignmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    unit_id: int
    title: str
    description: str | None = None
    due_at: datetime | None = None
    max_score: int
    status: str
    audience_mode: str = "all_attached_classes"
    effective_class_id: int | None = None
    policy_source: Literal["base", "class_policy"] = "base"
    unit_release_state: EffectiveReleaseState | None = None
    unit_lock_reasons: list[str] = Field(default_factory=list)


class AssignmentAudienceUpdate(BaseModel):
    audience_mode: AssignmentAudienceMode


class LearningEventCreate(BaseModel):
    event_type: LearningEventType
    class_id: int | None = None
    course_id: int | None = None
    unit_id: int | None = None
    assignment_id: int | None = None
    knowledge_code: str | None = Field(default=None, max_length=120)
    payload: dict[str, Any] = Field(default_factory=dict)
    occurred_at: datetime | None = None


class LearningEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    school_id: int | None = None
    class_id: int | None = None
    course_id: int | None = None
    unit_id: int | None = None
    assignment_id: int | None = None
    knowledge_code: str | None = None
    event_type: str
    payload: dict[str, Any]
    occurred_at: datetime


class LearningEventPage(BaseModel):
    items: list[LearningEventRead]
    total: int
    limit: int
    offset: int
    next_offset: int | None = None


class SubmissionCreate(BaseModel):
    class_id: int
    content: dict[str, Any] = Field(default_factory=dict)


class SubmissionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    assignment_id: int
    student_id: int
    class_id: int | None = None
    content: dict[str, Any]
    status: str
    score: int | None = None
    feedback: str | None = None
    graded_by_user_id: int | None = None
    submitted_at: datetime
    graded_at: datetime | None = None


class AssignmentSubmissionPage(BaseModel):
    items: list[SubmissionRead]
    total: int
    limit: int
    offset: int
    next_offset: int | None = None


class AssignmentReviewRead(BaseModel):
    course_id: int
    unit_id: int
    assignment: AssignmentRead
    submission: SubmissionRead | None = None
    can_submit: bool
    read_only: bool
    submit_block_reason: str | None = None


class StudentAssignmentCenterItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    class_: ClassRead = Field(alias="class")
    course: CourseRead
    unit: CourseUnitRead
    assignment: AssignmentRead
    submission: SubmissionRead | None = None
    can_submit: bool
    read_only: bool
    submit_block_reason: str | None = None


class StudentAssignmentCenterPage(BaseModel):
    items: list[StudentAssignmentCenterItem]
    total: int
    limit: int
    offset: int
    next_offset: int | None = None


class SubmissionGrade(BaseModel):
    score: int = Field(ge=0, le=1000)
    feedback: str | None = Field(default=None, max_length=4000)
    status: SubmissionGradeStatus = "graded"


class PointLedgerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    school_id: int | None = None
    class_id: int | None = None
    assignment_id: int | None = None
    submission_id: int | None = None
    delta: int
    reason: str
    note: str | None = None
    created_by_user_id: int | None = None


class AssignmentPointRuleUpdate(BaseModel):
    enabled: bool = True
    points_per_score: int = Field(default=1, ge=0, le=1000)
    max_points: int | None = Field(default=None, ge=0, le=100000)


class AssignmentPointRuleRead(BaseModel):
    assignment_id: int
    enabled: bool
    points_per_score: int
    max_points: int | None = None
    source: AssignmentPointRuleSource


class AssignmentClassPolicyUpdate(BaseModel):
    assigned: bool = True
    status_override: AssignmentStatus | None = None
    due_at_overridden: bool = False
    due_at_override: datetime | None = None
    point_rule: AssignmentPointRuleUpdate | None = None


class AssignmentClassPolicyRead(BaseModel):
    id: int | None = None
    persisted: bool
    assignment_id: int
    class_id: int
    assigned: bool
    status_override: str | None = None
    due_at_overridden: bool
    due_at_override: datetime | None = None
    point_rule: AssignmentPointRuleRead
    effective_assignment: AssignmentRead


class ProgressSummary(BaseModel):
    user_id: int
    submitted_assignments: int
    graded_assignments: int
    learning_events: int
    completed_events: int
    total_points: int
    completion_percent: float


class StudentBlockProgressRead(BaseModel):
    course_unit_id: int
    activity_key: str
    position: int
    started: bool
    completed: bool
    submitted: int
    graded: int
    recent_activity_at: datetime | None = None
    effective_release_state: EffectiveReleaseState


class StudentCourseProgressRow(BaseModel):
    student_id: int
    display_name: str
    blocks: list[StudentBlockProgressRead]


class StudentCourseProgressPage(BaseModel):
    course_id: int
    class_id: int
    plan_version: int
    items: list[StudentCourseProgressRow]
    total: int
    limit: int
    offset: int
    next_offset: int | None = None
