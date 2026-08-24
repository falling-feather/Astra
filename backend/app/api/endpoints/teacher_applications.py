from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user
from app.db.session import get_db
from app.schemas.teacher_application import (
    TeacherApplicationCreate,
    TeacherApplicationPage,
    TeacherApplicationRead,
    TeacherApplicationReview,
)
from app.services import teacher_applications


router = APIRouter()


@router.post(
    "/teacher-applications",
    response_model=TeacherApplicationRead,
    status_code=status.HTTP_201_CREATED,
)
def create_teacher_application(
    payload: TeacherApplicationCreate,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TeacherApplicationRead:
    application = teacher_applications.create_teacher_application(
        db,
        applicant=current_user,
        message=payload.message,
        request=request,
    )
    return teacher_applications.read_teacher_application(db, application)


@router.get("/teacher-applications/me", response_model=TeacherApplicationRead | None)
def read_my_teacher_application(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TeacherApplicationRead | None:
    application = teacher_applications.latest_teacher_application(db, current_user.id)
    return teacher_applications.read_teacher_application(db, application) if application is not None else None


@router.get("/admin/teacher-applications", response_model=TeacherApplicationPage)
def list_admin_teacher_applications(
    status_filter: Literal["pending", "approved", "rejected"] | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TeacherApplicationPage:
    items, total, next_page = teacher_applications.list_teacher_applications(
        db,
        admin=current_user,
        status_filter=status_filter,
        limit=limit,
        offset=offset,
    )
    return TeacherApplicationPage(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        next_offset=next_page,
    )


@router.patch("/admin/teacher-applications/{application_id}", response_model=TeacherApplicationRead)
def review_admin_teacher_application(
    application_id: int,
    payload: TeacherApplicationReview,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TeacherApplicationRead:
    application, applicant = teacher_applications.review_teacher_application(
        db,
        application_id=application_id,
        reviewer=current_user,
        decision=payload.status,
        note=payload.note,
        request=request,
    )
    return teacher_applications.teacher_application_read(application, applicant)
