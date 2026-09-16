from datetime import datetime
from typing import Any, Literal

from pydantic import Field, model_validator

from app.schemas.content_platform import CheckpointAttemptCreate, CheckpointAttemptRead, PlatformDto
from app.schemas.course_workflow import WorkflowCommand
from app.schemas.learning_resources import ResourceVersionRead


class LearningContextStart(WorkflowCommand):
    mode: Literal["formal", "explore", "preview"]
    course_id: int | None = Field(default=None, ge=1)
    course_unit_id: int | None = Field(default=None, ge=1)
    expected_release_id: int | None = Field(default=None, ge=1)
    resource_version_id: int | None = Field(default=None, ge=1)
    assignment_id: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def mode_scope(self):
        if self.mode == "formal":
            if self.course_id is None or self.course_unit_id is None or self.expected_release_id is None:
                raise ValueError("正式学习须指定课程、单元与所见发布版")
        elif self.resource_version_id is None or any(value is not None for value in (self.course_id, self.course_unit_id, self.expected_release_id, self.assignment_id)):
            raise ValueError("资源探索与预览只使用资源版本，不携带课程成绩身份")
        return self


class LearningContextRead(PlatformDto):
    context_key: str
    mode: Literal["formal", "explore", "preview"]
    user_id: int
    course_id: int | None
    course_unit_id: int | None
    class_id: int | None
    course_release_id: int | None
    release_number: int | None
    release_unit_id: int | None
    published_at: datetime | None
    activity_key: str | None
    content_schema_sha256: str | None
    resource_version_id: int | None
    assignment_id: int | None
    assignment: dict[str, Any] | None
    created_at: datetime
    course_title: str | None
    unit_title: str | None
    content: dict[str, Any] | None
    resources: list[ResourceVersionRead]
    newer_release_available: bool
    records_course_results: bool


class ContextCheckpointAnswer(PlatformDto):
    client_attempt_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    selected_choice_ids: list[str] = Field(default_factory=list, max_length=12)
    numeric_answer: float | None = Field(default=None, allow_inf_nan=False)
    text_answer: str | None = Field(default=None, min_length=1, max_length=2000)

    @model_validator(mode="after")
    def valid_response(self):
        CheckpointAttemptCreate.model_validate({**self.model_dump(), "course_release_id": 1})
        return self


class ContextCheckpointRead(CheckpointAttemptRead):
    context_key: str
    result_id: int
    current_version_completed: bool


class AssignmentAttemptCommand(WorkflowCommand):
    context_key: str | None = Field(default=None, min_length=1, max_length=36)
    class_id: int | None = Field(default=None, ge=1)
    expected_submission_revision: int = Field(ge=0)
    expected_assignment_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    content: dict[str, Any]

    @model_validator(mode="after")
    def bounded_content(self):
        import json
        if not self.content or len(json.dumps(self.content, ensure_ascii=False, allow_nan=False).encode("utf-8")) > 256 * 1024:
            raise ValueError("请提供不超过 256 KiB 的作业回答")
        return self


class AssignmentGradeCommand(WorkflowCommand):
    expected_grade_revision: int = Field(ge=0)
    expected_submission_revision: int = Field(ge=1)
    status: Literal["graded", "returned"]
    score: int | None = Field(default=None, ge=0, le=1000)
    feedback: str | None = Field(default=None, max_length=4000)
    allow_historical: bool = False

    @model_validator(mode="after")
    def grading_shape(self):
        if self.status == "graded" and self.score is None:
            raise ValueError("确认评分时须填写分数")
        if self.status == "returned" and not self.feedback:
            raise ValueError("退回作业时请说明需要修改的内容")
        return self


class AssignmentGradeRead(PlatformDto):
    id: int
    attempt_id: int
    revision: int
    submission_revision: int | None
    status: Literal["graded", "returned"]
    score: int | None
    max_score: int | None
    feedback: str | None
    graded_by_user_id: int | None
    graded_at: datetime | None
    recorded_at: datetime
    feedback_retained: bool
    provenance: str
    point_delta: int | None


class AssignmentAttemptRead(PlatformDto):
    id: int
    submission_id: int
    submission_revision: int | None
    assignment_id: int
    student_id: int
    class_id: int | None
    course_id: int
    course_unit_id: int
    course_release_id: int | None
    release_number: int | None
    context_key: str | None
    attempt_number: int
    content: dict[str, Any]
    assignment_snapshot: dict[str, Any]
    provenance: str
    submitted_at: datetime


class AssignmentHistoryRead(PlatformDto):
    submission_id: int
    revision: int
    current_attempt_id: int | None
    attempts: list[AssignmentAttemptRead]
    grades: list[AssignmentGradeRead]
    total: int
    limit: int
    offset: int
    next_offset: int | None


class AssignmentOpenCommand(WorkflowCommand):
    class_id: int | None = Field(default=None, ge=1)


class AssignmentWorkspaceRead(PlatformDto):
    assignment_id: int
    course_id: int
    course_unit_id: int
    class_id: int
    context: LearningContextRead | None
    assignment: dict[str, Any]
    assignment_sha256: str
    submission_id: int | None
    submission_revision: int
    attempt: AssignmentAttemptRead | None
    grade: AssignmentGradeRead | None
    can_submit: bool
    submit_block_reason: str | None


class LearningHistoryItem(PlatformDto):
    result_id: int
    student_id: int
    course_unit_id: int
    title: str
    kind: Literal["checkpoint", "assignment", "activity"]
    source_release_id: int | None
    source_release_number: int | None
    current_credit: bool
    recognized: bool
    valid: bool
    is_correct: bool | None
    score: int | None
    max_score: int | None
    feedback: str | None
    feedback_retained: bool
    response: dict[str, Any]
    prompt: str | None
    choices: list[dict[str, str]]
    occurred_at: datetime
    provenance: str


class LearningHistoryPage(PlatformDto):
    items: list[LearningHistoryItem]
    total: int
    offset: int
    limit: int
    next_offset: int | None
    current_release_id: int | None
    current_release_number: int | None
    current_completed_units: list[int]
    can_read_course: bool


class LearningResumeRead(PlatformDto):
    context_key: str
    course_id: int
    course_unit_id: int
    course_release_id: int
    release_number: int
    unit_title: str
    created_at: datetime
    is_current: bool
