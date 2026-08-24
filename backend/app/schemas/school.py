from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class SchoolCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    region: str | None = Field(default=None, max_length=160)


class SchoolRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    region: str | None = None
    description: str | None = None
    status: str
    version: int
    created_at: datetime
    updated_at: datetime


class ClassCreate(BaseModel):
    school_id: int
    name: str = Field(min_length=1, max_length=160)
    grade: str | None = Field(default=None, max_length=64)
    term: str | None = Field(default=None, max_length=64)


class ClassRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    school_id: int
    name: str
    kind: Literal["homeroom", "course_cohort"]
    grade: str | None = None
    term: str | None = None
    description: str | None = None
    status: str
    version: int
    created_at: datetime
    updated_at: datetime


class ClassJoinPayload(BaseModel):
    role: str = "student"


class ClassJoinRequestCreate(BaseModel):
    role: str = "student"
    message: str | None = Field(default=None, max_length=500)


class ClassJoinRequestReview(BaseModel):
    status: Literal["approved", "rejected"]
    note: str | None = Field(default=None, max_length=500)


class ClassMemberStatusUpdate(BaseModel):
    status: Literal["active", "inactive"]
    note: str | None = Field(default=None, max_length=500)


class ClassMemberBatchStatusItem(BaseModel):
    membership_id: int
    status: Literal["active", "inactive"]
    note: str | None = Field(default=None, max_length=500)


class ClassMemberBatchStatusUpdate(BaseModel):
    items: list[ClassMemberBatchStatusItem] = Field(min_length=1, max_length=100)


class ClassTeacherTransfer(BaseModel):
    source_membership_id: int
    target_user_id: int
    deactivate_source: bool = True
    note: str | None = Field(default=None, max_length=500)


class ClassStudentTransfer(BaseModel):
    target_class_id: int
    note: str | None = Field(default=None, max_length=500)


class ClassStudentBatchImportItem(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    client_ref: str | None = Field(default=None, max_length=64)


class ClassStudentBatchImport(BaseModel):
    items: list[ClassStudentBatchImportItem] = Field(min_length=1, max_length=100)


class ClassJoinRequestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    school_id: int
    class_id: int
    user_id: int
    role: str
    status: str
    message: str | None = None
    requested_by_user_id: int
    reviewed_by_user_id: int | None = None
    reviewed_at: datetime | None = None
    review_note: str | None = None


class MembershipRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    role: str
    status: str


class ClassMemberRead(BaseModel):
    id: int
    class_id: int
    user_id: int
    username: str
    display_name: str
    user_status: str
    role: str
    status: str
    created_at: datetime
    updated_at: datetime


class ClassMemberPage(BaseModel):
    items: list[ClassMemberRead]
    total: int
    limit: int
    offset: int
    next_offset: int | None = None


class ClassTeacherTransferRead(BaseModel):
    source_membership: ClassMemberRead
    target_membership: ClassMemberRead


class ClassStudentTransferRead(BaseModel):
    source_membership: ClassMemberRead
    target_membership: ClassMemberRead
    applied: bool


class ClassStudentBatchImportResult(BaseModel):
    username: str
    client_ref: str | None = None
    outcome: Literal["created", "restored", "unchanged", "failed"]
    membership: ClassMemberRead | None = None
    error_code: Literal["duplicate_item", "invalid_username", "student_not_eligible"] | None = None


class ClassStudentBatchImportRead(BaseModel):
    items: list[ClassStudentBatchImportResult]
    created_count: int
    restored_count: int
    unchanged_count: int
    failed_count: int
