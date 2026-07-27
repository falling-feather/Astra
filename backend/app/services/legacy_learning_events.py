"""Narrow domain helpers for the deprecated learning-event compatibility API."""

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Assignment, Course, CourseUnit
from app.schemas.course import LearningEventCreate


def reject_retired_complete_write(event_type: str) -> None:
    if event_type == "complete":
        raise HTTPException(
            status_code=409,
            detail=(
                "Legacy complete writes are retired; use versioned learning "
                "evidence and an active completion rule"
            ),
        )


def resolve_learning_scope(
    db: Session,
    payload: LearningEventCreate,
) -> tuple[Course | None, CourseUnit | None, Assignment | None]:
    assignment: Assignment | None = None
    unit: CourseUnit | None = None
    course: Course | None = None
    if payload.assignment_id is not None:
        assignment = db.get(Assignment, payload.assignment_id)
        if assignment is None:
            raise HTTPException(status_code=404, detail="Assignment not found")
        unit = db.get(CourseUnit, assignment.unit_id)
        if unit is None:
            raise HTTPException(status_code=404, detail="Course unit not found")
        course = db.get(Course, unit.course_id)
    elif payload.unit_id is not None:
        unit = db.get(CourseUnit, payload.unit_id)
        if unit is None:
            raise HTTPException(status_code=404, detail="Course unit not found")
        course = db.get(Course, unit.course_id)
    elif payload.course_id is not None:
        course = db.get(Course, payload.course_id)
    if course is None and (
        payload.course_id is not None or unit is not None
    ):
        raise HTTPException(status_code=404, detail="Course not found")
    if (
        payload.course_id is not None
        and course is not None
        and course.id != payload.course_id
    ):
        raise HTTPException(
            status_code=422,
            detail="Course scope does not match referenced resource",
        )
    if (
        payload.unit_id is not None
        and unit is not None
        and unit.id != payload.unit_id
    ):
        raise HTTPException(
            status_code=422,
            detail="Unit scope does not match referenced resource",
        )
    return course, unit, assignment
