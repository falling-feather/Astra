"""HTTP adapters for assignment queries and versioned submission commands."""

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user
from app.api.service_calls import service_call
from app.db.session import get_db
from app.schemas.course import (
    AssignmentReviewRead,
    AssignmentSubmissionPage,
    StudentAssignmentCenterPage,
    StudentAssignmentFilter,
    SubmissionCreate,
    SubmissionGrade,
    SubmissionRead,
)
from app.services import assignment_history, submissions_queries

router = APIRouter()


@router.get("/assignments/me", response_model=StudentAssignmentCenterPage)
def list_my_assignments(
    class_id: int | None = Query(default=None),
    course_id: int | None = Query(default=None),
    filter_by: StudentAssignmentFilter = Query(default="all", alias="filter"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StudentAssignmentCenterPage:
    return submissions_queries.list_my_assignments(
        db,
        current_user=current_user,
        class_id=class_id,
        course_id=course_id,
        filter_by=filter_by,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/assignments/{assignment_id}/submissions",
    response_model=SubmissionRead,
    status_code=status.HTTP_201_CREATED,
)
def create_submission(
    assignment_id: int,
    payload: SubmissionCreate,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SubmissionRead:
    return service_call(
        db,
        assignment_history.legacy_submit,
        actor=current_user,
        assignment_id=assignment_id,
        payload=payload,
        request=request,
    )


@router.get("/assignments/{assignment_id}/review", response_model=AssignmentReviewRead)
def read_assignment_review(
    assignment_id: int,
    class_id: int | None = Query(default=None),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AssignmentReviewRead:
    return submissions_queries.read_assignment_review(
        db,
        current_user=current_user,
        assignment_id=assignment_id,
        class_id=class_id,
    )


@router.get("/assignments/{assignment_id}/submissions", response_model=list[SubmissionRead], deprecated=True)
def list_assignment_submissions(
    assignment_id: int,
    class_id: int | None = Query(default=None),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[SubmissionRead]:
    return submissions_queries.list_assignment_submissions(
        db,
        current_user=current_user,
        assignment_id=assignment_id,
        class_id=class_id,
    )


@router.get("/assignments/{assignment_id}/submissions/page", response_model=AssignmentSubmissionPage)
def list_assignment_submissions_page(
    assignment_id: int,
    class_id: int | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AssignmentSubmissionPage:
    return submissions_queries.list_assignment_submissions_page(
        db,
        current_user=current_user,
        assignment_id=assignment_id,
        class_id=class_id,
        limit=limit,
        offset=offset,
    )


@router.patch("/submissions/{submission_id}/grade", response_model=SubmissionRead)
def grade_submission(
    submission_id: int,
    payload: SubmissionGrade,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SubmissionRead:
    return service_call(
        db,
        assignment_history.legacy_grade,
        actor=current_user,
        submission_id=submission_id,
        payload=payload,
        request=request,
    )
