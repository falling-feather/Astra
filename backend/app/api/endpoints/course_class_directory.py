from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user
from app.db.session import get_db
from app.schemas.school import ClassRead
from app.services.course_class_directory import active_teaching_classes

router = APIRouter()


@router.get("/{course_id}/classes", response_model=list[ClassRead])
def list_course_classes(
    course_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ClassRead]:
    return [ClassRead.model_validate(group) for group in active_teaching_classes(db, current_user, course_id)]
