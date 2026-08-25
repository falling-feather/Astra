from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

CourseJoinRequestStatus = Literal["pending", "approved", "rejected"]
CourseEnrollmentStatus = Literal["active", "left"]


class CourseAdmissionTeacherRead(BaseModel):
    user_id: int
    display_name: str
    is_creator: bool


class CourseAdmissionSourceClassRead(BaseModel):
    class_id: int
    name: str
    grade: str | None = None
    term: str | None = None


class CourseJoinRequestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_class_id: int | None = Field(default=None, ge=1)
    message: str | None = Field(default=None, max_length=500)

    @field_validator("message")
    @classmethod
    def normalize_message(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class CourseJoinRequestReview(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["approved", "rejected"]
    note: str | None = Field(default=None, max_length=500)

    @field_validator("note")
    @classmethod
    def normalize_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class CourseJoinRequestRead(BaseModel):
    id: int
    course_id: int
    student_id: int
    username: str
    display_name: str
    user_status: str
    source_class_id: int | None = None
    source_class_name: str
    request_number: int
    message: str | None = None
    status: CourseJoinRequestStatus
    reviewed_by_user_id: int | None = None
    reviewed_at: datetime | None = None
    review_note: str | None = None
    created_at: datetime
    updated_at: datetime


class CourseJoinRequestPage(BaseModel):
    items: list[CourseJoinRequestRead]
    total: int
    limit: int
    offset: int
    next_offset: int | None = None


class CourseEnrollmentRead(BaseModel):
    id: int
    course_id: int
    student_id: int
    username: str
    display_name: str
    user_status: str
    source_class_id: int | None = None
    source_class_name: str
    source: Literal["request", "class_batch", "teacher", "admin"]
    status: CourseEnrollmentStatus
    created_at: datetime
    updated_at: datetime


class CourseEnrollmentPage(BaseModel):
    items: list[CourseEnrollmentRead]
    total: int
    limit: int
    offset: int
    next_offset: int | None = None


class CourseAdmissionDiscoveryRead(BaseModel):
    course_id: int
    school_id: int
    course_code: str
    title: str
    summary: str | None = None
    galaxy_key: str
    subject_key: str
    academic_year: str | None = None
    schedule_text: str | None = None
    total_hours: int | None = None
    admission_mode: Literal["open", "class_restricted"]
    teachers: list[CourseAdmissionTeacherRead]
    eligible_source_classes: list[CourseAdmissionSourceClassRead]
    can_request: bool
    eligibility_reason: Literal[
        "eligible",
        "class_not_eligible",
        "request_pending",
        "already_enrolled",
    ]
    latest_join_request: CourseJoinRequestRead | None = None
    enrollment: CourseEnrollmentRead | None = None


class CourseClassBatchEnrollmentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    class_id: int = Field(ge=1)


class CourseClassBatchEnrollmentResult(BaseModel):
    student_id: int
    username: str
    display_name: str
    outcome: Literal[
        "created",
        "already_enrolled",
        "previously_left",
        "student_not_eligible",
    ]
    enrollment: CourseEnrollmentRead | None = None
    join_request_status: CourseJoinRequestStatus | None = None


class CourseClassBatchEnrollmentRead(BaseModel):
    class_id: int
    class_name: str
    items: list[CourseClassBatchEnrollmentResult]
    created_count: int
    already_enrolled_count: int
    previously_left_count: int
    ineligible_count: int


class CourseEnrollmentStatusPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["left"]
    note: str | None = Field(default=None, max_length=500)

    @field_validator("note")
    @classmethod
    def normalize_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None
