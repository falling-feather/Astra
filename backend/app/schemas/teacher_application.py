from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


TeacherApplicationStatus = Literal["pending", "approved", "rejected"]
TeacherApplicationDecision = Literal["approved", "rejected"]


class TeacherApplicationCreate(BaseModel):
    message: str | None = Field(default=None, max_length=1000)


class TeacherApplicationReview(BaseModel):
    status: TeacherApplicationDecision
    note: str | None = Field(default=None, max_length=1000)


class TeacherApplicationRead(BaseModel):
    id: int
    user_id: int
    applicant_username: str
    applicant_display_name: str
    applicant_role: str
    status: TeacherApplicationStatus
    message: str | None = None
    reviewed_by_user_id: int | None = None
    reviewed_at: datetime | None = None
    review_note: str | None = None
    created_at: datetime
    updated_at: datetime


class TeacherApplicationPage(BaseModel):
    items: list[TeacherApplicationRead]
    total: int
    limit: int
    offset: int
    next_offset: int | None = None
