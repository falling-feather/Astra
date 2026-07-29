from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user
from app.db.session import get_db
from app.schemas.course_status import CourseStatusPatch, CourseStatusUpdateRead
from app.services import course_status as course_status_service


router = APIRouter()


@router.patch("/{course_id}/status", response_model=CourseStatusUpdateRead)
def update_course_status(
    course_id: int,
    payload: CourseStatusPatch,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CourseStatusUpdateRead:
    return course_status_service.update_course_status(
        db,
        actor=current_user,
        course_id=course_id,
        payload=payload,
        request=request,
    )
