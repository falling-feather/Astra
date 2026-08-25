from datetime import datetime
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, Field

WorkbenchItem = TypeVar("WorkbenchItem")


class WorkbenchPage(BaseModel, Generic[WorkbenchItem]):
    items: list[WorkbenchItem]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=20)
    offset: int = Field(ge=0)
    next_offset: int | None = Field(default=None, ge=0)


class WorkbenchSectionIssue(BaseModel):
    section: str
    code: Literal["section_unavailable"] = "section_unavailable"
    message: str


class WorkbenchPrimaryAction(BaseModel):
    kind: str
    label: str
    section: str
    course_id: int | None = None
    course_unit_id: int | None = None
    assignment_id: int | None = None
    class_id: int | None = None
    submission_id: int | None = None
    request_id: int | None = None
    revision_id: int | None = None


class StudentCourseSummary(BaseModel):
    course_id: int
    title: str
    course_code: str | None = None
    galaxy_key: str
    subject_key: str
    schedule_text: str | None = None
    current_release_id: int | None = None
    current_release_number: int | None = None
    published_unit_count: int = Field(ge=0)
    completed_unit_count: int = Field(ge=0)


class StudentAssignmentSummary(BaseModel):
    assignment_id: int
    course_id: int
    course_title: str
    course_unit_id: int
    unit_title: str
    title: str
    due_at: datetime | None = None
    state: Literal["pending", "submitted", "graded", "returned"]
    score: int | None = None
    feedback: str | None = None


class StudentContinueLearningSummary(BaseModel):
    course_id: int
    course_title: str
    course_unit_id: int
    unit_title: str
    activity_key: str
    last_occurred_at: datetime
    cursor: dict


class StudentHomeroomSummary(BaseModel):
    class_id: int
    name: str
    grade: str | None = None
    term: str | None = None


class StudentSubmissionSummary(BaseModel):
    submitted: int = Field(ge=0)
    graded: int = Field(ge=0)
    returned: int = Field(ge=0)


class StudentWorkbenchDTO(BaseModel):
    role: Literal["student"] = "student"
    generated_at: datetime
    primary_action: WorkbenchPrimaryAction
    courses: WorkbenchPage[StudentCourseSummary]
    assignments: WorkbenchPage[StudentAssignmentSummary]
    continue_learning: StudentContinueLearningSummary | None = None
    submissions: StudentSubmissionSummary
    homerooms: WorkbenchPage[StudentHomeroomSummary]
    section_errors: list[WorkbenchSectionIssue] = Field(default_factory=list)


class TeacherCourseSummary(BaseModel):
    course_id: int
    title: str
    status: str
    course_code: str | None = None
    galaxy_key: str
    subject_key: str
    current_release_number: int | None = None
    content_draft_revision: int = Field(ge=0)
    has_unpublished_changes: bool
    active_student_count: int = Field(ge=0)
    pending_student_count: int = Field(ge=0)


class TeacherJoinRequestSummary(BaseModel):
    request_id: int
    course_id: int
    course_title: str
    student_id: int
    student_display_name: str
    source_class_name: str
    requested_at: datetime


class TeacherDraftSummary(BaseModel):
    course_id: int
    course_title: str
    content_draft_revision: int = Field(ge=0)
    current_release_number: int | None = None
    last_published_draft_revision: int | None = None
    updated_at: datetime


class TeacherSubmissionSummary(BaseModel):
    submission_id: int
    class_id: int
    assignment_id: int
    assignment_title: str
    course_id: int
    course_title: str
    course_unit_id: int
    unit_title: str
    student_id: int
    student_display_name: str
    submitted_at: datetime


class TeacherWorkbenchDTO(BaseModel):
    role: Literal["teacher"] = "teacher"
    generated_at: datetime
    primary_action: WorkbenchPrimaryAction
    courses: WorkbenchPage[TeacherCourseSummary]
    pending_students: WorkbenchPage[TeacherJoinRequestSummary]
    unpublished_drafts: WorkbenchPage[TeacherDraftSummary]
    pending_grading: WorkbenchPage[TeacherSubmissionSummary]
    section_errors: list[WorkbenchSectionIssue] = Field(default_factory=list)


class AdminTeacherApplicationSummary(BaseModel):
    application_id: int
    user_id: int
    username: str
    display_name: str
    message: str | None = None
    submitted_at: datetime


class AdminCourseRevisionSummary(BaseModel):
    revision_id: int
    course_id: int
    course_title: str
    revision_number: int = Field(ge=1)
    school_id: int
    submitted_at: datetime


class AdminOrganizationAlert(BaseModel):
    kind: Literal["school", "class"]
    resource_id: int
    name: str
    status: str
    school_id: int | None = None


class AdminCatalogTotals(BaseModel):
    users: int = Field(ge=0)
    courses: int = Field(ge=0)
    active_schools: int = Field(ge=0)
    active_homerooms: int = Field(ge=0)


class AdminWorkbenchDTO(BaseModel):
    role: Literal["admin"] = "admin"
    generated_at: datetime
    primary_action: WorkbenchPrimaryAction
    pending_teacher_applications: WorkbenchPage[AdminTeacherApplicationSummary]
    pending_course_revisions: WorkbenchPage[AdminCourseRevisionSummary]
    organization_alerts: WorkbenchPage[AdminOrganizationAlert]
    catalog_totals: AdminCatalogTotals
    section_errors: list[WorkbenchSectionIssue] = Field(default_factory=list)


WorkbenchDTO = StudentWorkbenchDTO | TeacherWorkbenchDTO | AdminWorkbenchDTO
