from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user
from app.db.session import get_db
from app.schemas.course import ProgressSummary, StudentCourseProgressPage
from app.services.access_control import (
    active_assignment_class_ids,
    get_class,
    require_class_member,
    require_class_teacher_or_admin,
    get_course,
)
from app.services.course_release_plans import (
    build_student_course_progress_page,
    get_course_class_or_404,
)
from app.services.legacy_progress import (
    build_progress_summary,
    require_active_student_progress_target,
)


router = APIRouter()


@router.get("/me", response_model=ProgressSummary)
def get_my_progress(
    class_id: int | None = Query(default=None),
    current_user: Any = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProgressSummary:
    if class_id is not None:
        require_class_member(db, current_user, class_id)
    class_ids = [class_id] if class_id is not None else active_assignment_class_ids(db, current_user)
    return build_progress_summary(
        db,
        current_user.id,
        class_id,
        class_ids=class_ids,
        student_visible_resources=current_user.role == "student",
    )


@router.get("/users/{user_id}", response_model=ProgressSummary)
def get_user_progress(
    user_id: int,
    class_id: int,
    current_user: Any = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProgressSummary:
    class_group = get_class(db, class_id)
    require_class_teacher_or_admin(
        db,
        current_user,
        class_group,
        detail="Student progress requires class teacher scope",
    )
    require_active_student_progress_target(
        db,
        user_id=user_id,
        class_id=class_id,
    )
    return build_progress_summary(
        db,
        user_id,
        class_id,
        student_visible_resources=True,
    )


@router.get("/courses/{course_id}/classes/{class_id}/students", response_model=StudentCourseProgressPage)
def get_course_class_student_progress(
    course_id: int,
    class_id: int,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: Any = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StudentCourseProgressPage:
    course = get_course(db, course_id)
    class_group = get_class(db, class_id)
    if class_group.school_id != course.school_id:
        raise HTTPException(status_code=422, detail="Class does not belong to course school")
    require_class_teacher_or_admin(
        db,
        current_user,
        class_group,
        detail="Course progress matrix requires class teacher scope",
    )
    course_class = get_course_class_or_404(db, course.id, class_group.id)
    return StudentCourseProgressPage.model_validate(
        build_student_course_progress_page(
            db,
            course=course,
            class_group=class_group,
            course_class=course_class,
            limit=limit,
            offset=offset,
        )
    )
