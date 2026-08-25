from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user
from app.db.session import get_db
from app.models import User
from app.schemas.course_authoring import (
    CourseAuthoringOptionsRead,
    CourseDraftCreate,
    CourseDraftRead,
)
from app.services import course_authoring as course_authoring_service


router = APIRouter()


@router.post("/courses", response_model=CourseDraftRead, status_code=status.HTTP_201_CREATED)
def create_course_draft(
    payload: CourseDraftCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return course_authoring_service.get_visible_course_draft(
        db,
        actor=current_user,
        course_id=course_id,
    )


@router.post(
    "/courses/{course_id}/information-revisions/{revision_id}/submit",
    response_model=CourseDraftRead,
)
def submit_course_information_revision(
    course_id: int,
    revision_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return course_authoring_service.submit_information_revision(
        db,
        actor=current_user,
        course_id=course_id,
        revision_id=revision_id,
        request=request,
    )
