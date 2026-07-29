from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator


CourseUnitAccessErrorCode = Literal[
    "activity_hidden",
    "activity_locked",
    "course_unit_missing",
]


class CourseUnitAccessRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    available: bool
    error_code: CourseUnitAccessErrorCode | None

    @model_validator(mode="after")
    def validate_disposition(self) -> "CourseUnitAccessRead":
        if self.available != (self.error_code is None):
            raise ValueError("available and error_code must describe one disposition")
        return self
