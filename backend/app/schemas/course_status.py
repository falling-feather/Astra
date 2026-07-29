from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.course import CourseRead


CourseStatus = Literal["draft", "published", "archived"]


class CourseStatusPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_status: CourseStatus
    status: CourseStatus
    reason: str = Field(min_length=1, max_length=1000)

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("reason must not be blank")
        return normalized


class CourseStatusImpactRead(BaseModel):
    attached_class_count: int = Field(ge=0)
    course_unit_count: int = Field(ge=0)
    assignment_count: int = Field(ge=0)


class CourseStatusUpdateRead(BaseModel):
    course: CourseRead
    impact: CourseStatusImpactRead
