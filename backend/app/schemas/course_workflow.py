"""Typed v2 course commands. Ownership and origin identities are never client writable."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import ConfigDict, Field, model_validator

from app.schemas.course_authoring import CourseDraftCreate, CourseDraftRead
from app.schemas.content_platform import CourseSharedDraftUnitRead, PlatformDto
from app.schemas.content_platform import CoursePublicationReceipt
from app.schemas.content_v2 import ContentPageV2
from app.schemas.learning_resources import ResourceVersionRead


class CourseSettings(CourseDraftCreate):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, strict=True)
    level_key: str | None = Field(default=None, max_length=32, pattern=r"^[a-z][a-z0-9-]*$")


class WorkflowCommand(PlatformDto):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, strict=True)
    client_request_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")


class CourseCreateCommand(CourseSettings, WorkflowCommand):
    pass


class CourseUnitWrite(PlatformDto):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, strict=True)
    id: int | None = Field(default=None, ge=1)
    activity_key: str | None = Field(default=None, max_length=120, pattern=r"^[a-z0-9][a-z0-9._:-]*$")
    resource_version_id: int | None = Field(default=None, ge=1)
    title: str = Field(min_length=1, max_length=180)
    position: int = Field(ge=1, le=10000)
    content: ContentPageV2


class CourseDraftCommand(WorkflowCommand):
    expected_revision: int = Field(ge=0)
    expected_state_token: str = Field(pattern=r"^[0-9a-f]{64}$")
    settings: CourseSettings
    units: list[CourseUnitWrite] = Field(max_length=200)

    @model_validator(mode="after")
    def unique_instances(self):
        ids = [unit.id for unit in self.units if unit.id is not None]
        if len(ids) != len(set(ids)) or len({unit.position for unit in self.units}) != len(self.units):
            raise ValueError("单元实例和顺序不能重复")
        return self


class CourseForkCommand(WorkflowCommand):
    settings: CourseSettings
    source_release_id: int | None = Field(default=None, ge=1)
    source_revision_id: int | None = Field(default=None, ge=1)
    expected_source_revision: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def one_source(self):
        if self.source_release_id is not None and self.source_revision_id is not None:
            raise ValueError("只能选择一个来源版本")
        if self.source_release_id is None and self.source_revision_id is None and self.expected_source_revision is None:
            raise ValueError("派生当前草稿时须提供来源修订号")
        return self


class CourseWorkflowRead(CourseDraftRead):
    family_id: int | None
    source_course_id: int | None
    source_release_id: int | None
    source_revision_id: int | None
    workflow_generation: int
    level_key: str | None
    draft_settings: CourseSettings


class CourseDraftUnitReadV2(CourseSharedDraftUnitRead):
    origin_key: str
    block_origins: dict[str, str]
    resource_version_id: int | None


class CourseDraftReadV2(PlatformDto):
    course_id: int
    family_id: int | None
    revision: int
    revision_id: int | None
    state_token: str
    settings: CourseSettings
    units: list[CourseDraftUnitReadV2]
    resources: list[ResourceVersionRead]
    warnings: list[str] = Field(default_factory=list)


class CourseRevisionSummaryRead(PlatformDto):
    id: int
    course_id: int
    revision_number: int
    content_sha256: str
    created_by_user_id: int
    created_at: datetime


class CourseRevisionRead(CourseRevisionSummaryRead):
    snapshot: dict[str, Any]


class CourseRevisionPageRead(PlatformDto):
    items: list[CourseRevisionSummaryRead]
    total: int
    offset: int
    limit: int
    next_offset: int | None


class CourseForkRead(PlatformDto):
    course: CourseWorkflowRead
    draft: CourseDraftReadV2
    copied_units: int
    warnings: list[str]


class WorkflowReceiptRead(PlatformDto):
    client_request_id: str
    operation_kind: str
    response: dict[str, Any]


class SubmissionPreviewCommand(PlatformDto):
    source_revision: int = Field(ge=0)
    source_state_token: str = Field(pattern=r"^[0-9a-f]{64}$")
    base_revision_id: int | None = Field(default=None, ge=1)
    target_course_ids: list[int] = Field(default_factory=list, max_length=50)
    conflict_choices: dict[str, Literal["keep", "replace"]] = Field(default_factory=dict)

    @model_validator(mode="after")
    def unique_targets(self):
        if any(value <= 0 for value in self.target_course_ids) or len(self.target_course_ids) != len(set(self.target_course_ids)):
            raise ValueError("目标课程必须为不重复的有效编号")
        self.target_course_ids.sort()
        return self


class SubmitCandidateCommand(SubmissionPreviewCommand, WorkflowCommand):
    preview_token: str = Field(pattern=r"^[0-9a-f]{64}$")
    result_policies: dict[str, dict[str, Literal["keep", "redo"]]] = Field(default_factory=dict)
    note: str | None = Field(default=None, max_length=1000)


class ReviewSelection(PlatformDto):
    review_item_id: int = Field(ge=1)
    expected_version: int = Field(ge=1)


class ReviewCommand(WorkflowCommand):
    items: list[ReviewSelection] = Field(min_length=1, max_length=100)
    decision: Literal["approved", "rejected"]
    note: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def unique_items(self):
        if len({item.review_item_id for item in self.items}) != len(self.items):
            raise ValueError("审核项不能重复")
        return self


class WithdrawCommand(WorkflowCommand):
    expected_version: int = Field(ge=1)


class PublishSelection(PlatformDto):
    candidate_id: int = Field(ge=1)
    expected_review_version: int = Field(ge=1)


class PublishCommand(WorkflowCommand):
    items: list[PublishSelection] = Field(min_length=1, max_length=50)
    note: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def unique_items(self):
        if len({item.candidate_id for item in self.items}) != len(self.items):
            raise ValueError("发布候选不能重复")
        return self


class RestoreDraftCommand(WorkflowCommand):
    expected_revision: int = Field(ge=0)
    expected_state_token: str = Field(pattern=r"^[0-9a-f]{64}$")
    release_id: int = Field(ge=1)


class SnapshotUnitRead(PlatformDto):
    id: int
    activity_key: str
    origin_key: str
    block_origins: dict[str, str]
    resource_version_id: int | None
    title: str
    position: int
    content: ContentPageV2 | None


class CourseSnapshotRead(PlatformDto):
    settings: dict[str, Any]
    units: list[SnapshotUnitRead]


class SyncChangeRead(PlatformDto):
    key: str
    status: Literal["ready", "conflict", "unchanged", "skipped"]
    unit_title: str
    reason: str | None = None
    block_origin: str | None = None
    fields: list[str] = Field(default_factory=list)
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None
    current: dict[str, Any] | None = None
    unit_id: int | None = None
    block_id: str | None = None


class UnitImpactRead(PlatformDto):
    unit_id: int
    origin_key: str
    title: str
    change: Literal["added", "modified", "unchanged"]
    learning_changed: bool
    decision_required: bool
    default_policy: Literal["keep", "redo"] | None


class SettingChangeRead(PlatformDto):
    field: str
    before_recorded: bool
    before: Any
    after: Any


class RemovedUnitRead(PlatformDto):
    unit_id: int
    title: str


class SyncImpactRead(PlatformDto):
    source_course_id: int
    source_revision_id: int
    base_revision_id: int | None
    applied_changes: list[str]
    preview_changes: list[SyncChangeRead]


class CourseImpactRead(PlatformDto):
    settings: list[SettingChangeRead]
    units: list[UnitImpactRead]
    removed_units: list[RemovedUnitRead]
    sync: SyncImpactRead | None = None


class SubmissionCoursePreview(PlatformDto):
    course_id: int
    title: str
    revision: int
    state_token: str
    base_release_id: int | None
    pending_review_id: int | None
    changes: list[SyncChangeRead]
    impact: CourseImpactRead
    dependencies_sha256: str


class SubmissionPreviewRead(PlatformDto):
    source_course_id: int
    source_revision: int
    base_revision_id: int | None
    courses: list[SubmissionCoursePreview]
    preview_token: str


class CandidateActionRead(PlatformDto):
    candidate_id: int
    status: Literal["submitted", "approved", "rejected", "withdrawn"]
    review_version: int


class ReviewActionRead(CandidateActionRead):
    course_id: int
    review_item_id: int


class SubmissionItemRead(ReviewActionRead):
    revision_id: int


class SkippedCourseRead(PlatformDto):
    course_id: int
    reason: str


class SubmissionReceiptRead(PlatformDto):
    batch_id: int
    items: list[SubmissionItemRead]
    skipped: list[SkippedCourseRead]


class ReviewReceiptRead(PlatformDto):
    items: list[ReviewActionRead]


class PublishedCandidateRead(CoursePublicationReceipt):
    candidate_id: int
    course_id: int


class PublicationReceiptRead(PlatformDto):
    items: list[PublishedCandidateRead]


class CandidateSummaryRead(PlatformDto):
    candidate_id: int
    batch_id: int
    course_id: int
    course_title: str
    school_id: int
    revision_id: int
    base_release_id: int | None
    review_item_id: int
    review_version: int
    status: Literal["submitted", "approved", "rejected", "withdrawn"]
    review_note: str | None
    reviewed_by_user_id: int | None
    reviewed_at: datetime | None
    created_at: datetime
    published_release_id: int | None
    candidate_sha256: str


class CandidatePageRead(PlatformDto):
    items: list[CandidateSummaryRead]
    total: int
    offset: int
    limit: int
    next_offset: int | None


class CandidateDetailRead(CandidateSummaryRead):
    snapshot: CourseSnapshotRead
    baseline: CourseSnapshotRead
    impact: CourseImpactRead
    result_policies: dict[str, Literal["keep", "redo"]]
    dependencies: dict[str, Any]
    source_revision_id: int | None
    submitted_by_user_id: int
    note: str | None
    stale: bool
    entity_labels: dict[str, dict[str, str]] = Field(default_factory=dict)
