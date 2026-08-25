from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user
from app.db.session import get_db
from app.schemas.course_authoring import (
    CourseAuthoringOptionsRead,
    CourseDraftCreate,
    CourseDraftRead,
    CourseInformationRevisionReview,
    CourseInformationRevisionReviewPage,
    CourseInformationRevisionReviewRead,
)
from app.services import course_authoring as course_authoring_service
from app.services import course_information_reviews as course_information_review_service

router = APIRouter()


@router.post("/courses", response_model=CourseDraftRead, status_code=status.HTTP_201_CREATED)
def create_course_draft(
    payload: CourseDraftCreate,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return course_authoring_service.create_course_draft(
        db,
        actor=current_user,
        payload=payload,
        request=request,
    )


@router.get("/courses", response_model=list[CourseDraftRead])
def list_course_drafts(
    school_id: int | None = Query(default=None, ge=1),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    return course_authoring_service.list_visible_course_drafts(
        db,
        actor=current_user,
        school_id=school_id,
    )


@router.get("/courses/authoring-options", response_model=CourseAuthoringOptionsRead)
def get_course_authoring_options(
    school_id: int = Query(ge=1),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return course_authoring_service.get_course_authoring_options(
        db,
        actor=current_user,
        school_id=school_id,
    )


@router.get("/courses/{course_id}", response_model=CourseDraftRead)
def get_course_draft(
    course_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return course_authoring_service.get_visible_course_draft(
        db,
        actor=current_user,
        course_id=course_id,
    )


@router.post(
    "/courses/{course_id}/information-revisions",
    response_model=CourseDraftRead,
    status_code=status.HTTP_201_CREATED,
)
def create_course_information_revision(
    course_id: int,
    payload: CourseDraftCreate,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return course_authoring_service.create_information_revision(
        db,
        actor=current_user,
        course_id=course_id,
        payload=payload,
        request=request,
    )


@router.post(
    "/courses/{course_id}/information-revisions/{revision_id}/submit",
    response_model=CourseDraftRead,
)
def submit_course_information_revision(
    course_id: int,
    revision_id: int,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return course_authoring_service.submit_information_revision(
        db,
        actor=current_user,
        course_id=course_id,
        revision_id=revision_id,
        request=request,
    )


@router.get(
    "/admin/course-information-revisions",
    response_model=CourseInformationRevisionReviewPage,
)
def list_admin_course_information_revisions(
    status_filter: Literal["draft", "submitted", "approved", "rejected"] | None = Query(
        default="submitted",
        alias="status",
    ),
    school_id: int | None = Query(default=None, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CourseInformationRevisionReviewPage:
    items, total, next_page = course_information_review_service.list_information_revisions(
        db,
        admin=current_user,
        status_filter=status_filter,
        school_id=school_id,
        limit=limit,
        offset=offset,
    )
    return CourseInformationRevisionReviewPage(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        next_offset=next_page,
    )


@router.patch(
    "/admin/course-information-revisions/{revision_id}",
    response_model=CourseInformationRevisionReviewRead,
)
def review_admin_course_information_revision(
    revision_id: int,
    payload: CourseInformationRevisionReview,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return course_information_review_service.review_information_revision(
        db,
        revision_id=revision_id,
        reviewer=current_user,
        decision=payload.status,
        note=payload.note,
        request=request,
    )
