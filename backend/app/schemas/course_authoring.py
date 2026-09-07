from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.course import _normalize_stable_key

CourseAdmissionMode = Literal["open", "class_restricted"]
CourseContentStatus = Literal["not_published", "published"]


class CourseDraftCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    school_id: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=180)
    summary: str | None = Field(default=None, max_length=2000)
    academic_year: str = Field(min_length=1, max_length=32)
    schedule_text: str = Field(min_length=1, max_length=240)
    total_hours: int = Field(ge=1, le=10000)
    galaxy_key: str = Field(min_length=1, max_length=32)
    subject_key: str = Field(min_length=1, max_length=96)
    admission_mode: CourseAdmissionMode
    collaborator_user_ids: list[int] = Field(default_factory=list, max_length=100)
    admission_class_ids: list[int] = Field(default_factory=list, max_length=100)

    @field_validator("title", "academic_year", "schedule_text")
    @classmethod
    def normalize_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("value must not be blank")
        return normalized

    @field_validator("summary")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None

    @field_validator("galaxy_key")
    @classmethod
    def normalize_galaxy_key(cls, value: str) -> str:
        return _normalize_stable_key(value, field_name="galaxy_key", max_length=32)

    @field_validator("subject_key")
    @classmethod
    def normalize_subject_key(cls, value: str) -> str:
        return _normalize_stable_key(value, field_name="subject_key", max_length=96)

    @field_validator("collaborator_user_ids", "admission_class_ids")
    @classmethod
    def require_unique_ids(cls, value: list[int]) -> list[int]:
        if any(item <= 0 for item in value):
            raise ValueError("ids must be positive")
        if len(value) != len(set(value)):
            raise ValueError("ids must not contain duplicates")
        return value

    @model_validator(mode="after")
    def validate_admission_shape(self) -> "CourseDraftCreate":
        if self.admission_mode == "open" and self.admission_class_ids:
            raise ValueError("open courses must not define admission classes")
        if self.admission_mode == "class_restricted" and not self.admission_class_ids:
            raise ValueError("class-restricted courses require at least one admission class")
        return self


class CourseTeacherRead(BaseModel):
    user_id: int
    username: str
    display_name: str
    role: str
    is_creator: bool


class CourseInformationDraftUpdate(CourseDraftCreate):
    expected_revision: int = Field(ge=1)


class CourseAdmissionClassRead(BaseModel):
    class_id: int
    name: str
    status: str


class CourseAuthoringTeacherOption(BaseModel):
    user_id: int
    username: str
    display_name: str
    role: str


class CourseAuthoringClassOption(BaseModel):
    class_id: int
    name: str
    grade: str | None = None
    term: str | None = None


class CourseAuthoringOptionsRead(BaseModel):
    school_id: int
    teachers: list[CourseAuthoringTeacherOption]
    homerooms: list[CourseAuthoringClassOption]
    admission_modes: list[CourseAdmissionMode]


class CourseInformationRevisionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    course_id: int
    revision_number: int
    edit_revision: int
    information_snapshot: dict[str, Any]
    teacher_ids_snapshot: list[int]
    status: str
    created_by_user_id: int
    submitted_at: datetime | None = None
    reviewed_by_user_id: int | None = None
    reviewed_at: datetime | None = None
    review_note: str | None = None
    created_at: datetime
    updated_at: datetime


class CourseInformationRevisionReview(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["approved", "rejected"]
    note: str | None = Field(default=None, max_length=500)

    @field_validator("note")
    @classmethod
    def normalize_review_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class CourseDraftRead(BaseModel):
    id: int
    school_id: int
    creator_user_id: int
    course_code: str | None = None
    title: str
    summary: str | None = None
    academic_year: str
    schedule_text: str
    total_hours: int
    galaxy_key: str
    subject_key: str
    admission_mode: CourseAdmissionMode
    current_information_revision_id: int | None = None
    status: str
    teachers: list[CourseTeacherRead]
    admission_classes: list[CourseAdmissionClassRead]
    information_revision: CourseInformationRevisionRead
    has_published_content: bool
    content_status: CourseContentStatus
    content_status_label: str
    active_student_count: int = Field(default=0, ge=0)
    created_at: datetime
    updated_at: datetime


class CourseInformationRevisionReviewRead(BaseModel):
    revision: CourseInformationRevisionRead
    course_id: int
    school_id: int
    course_status: str
    course_code: str | None = None
    current_information_revision_id: int | None = None
    proposed_information: dict[str, Any]
    current_information: dict[str, Any] | None = None
    changed_fields: list[str]
    proposed_teachers: list[CourseTeacherRead]
    current_teachers: list[CourseTeacherRead]
    proposed_admission_classes: list[CourseAdmissionClassRead]
    current_admission_classes: list[CourseAdmissionClassRead]
    internal_class_id: int | None = None
    internal_course_class_id: int | None = None
    has_published_content: bool
    content_status: CourseContentStatus
    content_status_label: str


class CourseInformationRevisionReviewPage(BaseModel):
    items: list[CourseInformationRevisionReviewRead]
    total: int
    limit: int
    offset: int
    next_offset: int | None = None
