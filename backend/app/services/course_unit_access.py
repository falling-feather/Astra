from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import CourseUnit, User
from app.services.access_control import require_course_visible
from app.services.course_release_plans import (
    effective_unit_access,
    get_course_class_or_404,
    get_plan_for_unit,
    resolve_student_course_class,
)


def student_course_unit_access(
    db: Session,
    *,
    actor: User,
    course_id: int,
    class_id: int,
    activity_key: str,
) -> dict:
    if actor.role != "student":
        raise HTTPException(
            status_code=403,
            detail="Course unit access disposition requires student role",
        )

    course = require_course_visible(db, actor, course_id)
    class_group = resolve_student_course_class(
        db,
        student_id=actor.id,
        course_id=course.id,
        class_id=class_id,
        detail="class_id is required for student course unit access",
    )
    if class_group.school_id != course.school_id:
        raise HTTPException(
            status_code=403,
            detail="Class is outside current student course scope",
        )
    course_class = get_course_class_or_404(db, course.id, class_group.id)
    if course_class.status != "active":
        raise HTTPException(
            status_code=403,
            detail="Class is outside current student course scope",
        )

    units = list(
        db.scalars(
            select(CourseUnit)
            .where(
                CourseUnit.course_id == course.id,
                CourseUnit.activity_key == activity_key,
            )
            .order_by(CourseUnit.id)
            .limit(2)
        ).all()
    )
    if not units:
        return {"available": False, "error_code": "course_unit_missing"}
    if len(units) != 1:
        raise HTTPException(
            status_code=409,
            detail="Course unit activity scope is inconsistent",
        )
    unit = units[0]

    plan = get_plan_for_unit(db, course_class, unit.id)
    if (
        plan.course_class_id != course_class.id
        or plan.course_unit_id != unit.id
    ):
        raise HTTPException(
            status_code=409,
            detail="Course release plan is inconsistent",
        )

    access = effective_unit_access(
        db,
        course=course,
        class_group=class_group,
        unit=unit,
        plan=plan,
        student_id=actor.id,
    )
    if access.state == "open":
        return {"available": True, "error_code": None}
    if access.state == "hidden":
        return {"available": False, "error_code": "activity_hidden"}
    if access.state == "locked":
        return {"available": False, "error_code": "activity_locked"}
    raise HTTPException(
        status_code=409,
        detail="Course unit access state is inconsistent",
    )
