"""Transport contracts for V8.4 shared drafts and immutable releases."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.content_v2 import ContentPageV2

_STABLE_KEY_PATTERN = r"^[a-z0-9][a-z0-9._:-]*$"


class PlatformDto(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class CourseSharedDraftUnitWrite(PlatformDto):
    id: int | None = Field(default=None, ge=1)
    activity_key: str = Field(min_length=1, max_length=120, pattern=_STABLE_KEY_PATTERN)
    title: str = Field(min_length=1, max_length=180)
    position: int = Field(ge=1, le=10_000)
    content: ContentPageV2


class CourseSharedDraftReplace(PlatformDto):
    expected_revision: int = Field(ge=0)
    units: list[CourseSharedDraftUnitWrite] = Field(max_length=200)

    @model_validator(mode="after")
    def reject_duplicate_unit_identity(self) -> "CourseSharedDraftReplace":
        ids = [item.id for item in self.units if item.id is not None]
        activity_keys = [item.activity_key for item in self.units]
        positions = [item.position for item in self.units]
        if len(ids) != len(set(ids)):
            raise ValueError("Shared draft contains duplicate unit ids")
        if len(activity_keys) != len(set(activity_keys)):
            raise ValueError("Shared draft contains duplicate activity keys")
        if len(positions) != len(set(positions)):
            raise ValueError("Shared draft contains duplicate positions")
        return self


class CourseSharedDraftUnitRead(PlatformDto):
    id: int
    content_draft_id: int | None = None
    revision: int
    activity_key: str
    title: str
    position: int
    content_slug: str | None = None
    content_schema_sha256: str | None = None
    last_editor_user_id: int | None = None
    content: ContentPageV2 | None = None


class CourseSharedDraftRead(PlatformDto):
    course_id: int
    revision: int
    status: str
    title: str
    summary: str | None = None
    updated_at: datetime
    units: list[CourseSharedDraftUnitRead]


class CourseReleasePublish(PlatformDto):
    expected_revision: int = Field(ge=0)
    note: str | None = Field(default=None, max_length=1000)


class CourseReleaseUnitRead(PlatformDto):
    id: int
    source_course_unit_id: int
    activity_key: str
    title: str
    position: int
    content_slug: str
    content_page_version_id: int
    content_schema_sha256: str
    media_snapshot: list[dict[str, Any]] = Field(default_factory=list)
    content: dict[str, Any]


class CourseReleaseRead(PlatformDto):
    id: int
    course_id: int
    release_number: int
    draft_revision: int
    schema_version: str
    title: str
    summary: str | None = None
    completion_rule_id: int | None = None
    completion_rule_sha256: str
    package_sha256: str
    published_by_user_id: int
    published_at: datetime
    units: list[CourseReleaseUnitRead]


class CourseClassReleaseBindingRead(PlatformDto):
    id: int
    course_class_id: int
    course_release_id: int
    binding_revision: int
    previous_binding_id: int | None = None
    bound_by_user_id: int
    binding_reason: str | None = None
    bound_at: datetime


class CoursePublicationReceipt(PlatformDto):
    release: CourseReleaseRead
    binding: CourseClassReleaseBindingRead
    next_draft_revision: int


class CourseCurrentReleaseRead(PlatformDto):
    binding: CourseClassReleaseBindingRead
    release: CourseReleaseRead
