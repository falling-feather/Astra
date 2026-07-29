from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user
from app.db.session import get_db
from app.schemas.course_unit_access import CourseUnitAccessRead
from app.services import course_unit_access as course_unit_access_service


router = APIRouter()


@router.get("/{course_id}/unit-access", response_model=CourseUnitAccessRead)
def get_course_unit_access(
    course_id: int,
    class_id: int = Query(ge=1),
    activity_key: str = Query(
        min_length=1,
        max_length=120,
        pattern=r"^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$",
    ),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CourseUnitAccessRead:
    return course_unit_access_service.student_course_unit_access(
        db,
        actor=current_user,
        course_id=course_id,
        class_id=class_id,
        activity_key=activity_key,
    )
