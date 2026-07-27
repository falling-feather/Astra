"""Serialized release-scope gates shared by student and evidence writers."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    ClassGroup,
    ClassMembership,
    Course,
    CourseClass,
    CourseUnit,
    CourseUnitClassPlan,
    User,
)
from app.services.access_control import (
    lock_active_class_for_write,
    lock_course_for_write,
)
from app.services.course_release_plans import (
    EffectiveUnitAccess,
    effective_unit_access,
)
from app.services.learning_evidence_access import (
    authoritative_prerequisite_unit_ids,
)


@dataclass(frozen=True)
class LockedUnitReleaseScope:
    course_class: CourseClass
    unit: CourseUnit
    plan: CourseUnitClassPlan


def active_student_membership_statement(
    class_id: int,
    student_id: int,
    *,
    locking_read: bool = False,
):
    statement = (
        select(ClassMembership.id)
        .join(User, User.id == ClassMembership.user_id)
        .where(
            ClassMembership.class_id == class_id,
            ClassMembership.user_id == student_id,
            ClassMembership.role == "student",
            ClassMembership.status == "active",
            User.role == "student",
            User.status == "active",
        )
    )
    return statement.with_for_update() if locking_read else statement


def lock_unit_release_scope_for_write(
    db: Session,
    *,
    course: Course,
    class_group: ClassGroup,
    unit_id: int,
) -> LockedUnitReleaseScope:
    """Lock course-class -> unit -> plan after course/class anchors are held."""
    if class_group.school_id != course.school_id:
        raise HTTPException(status_code=403, detail="Class is outside course scope")
    course_class = db.scalar(
        select(CourseClass)
        .where(
            CourseClass.course_id == course.id,
            CourseClass.class_id == class_group.id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if course_class is None:
        raise HTTPException(
            status_code=403,
            detail="Course is not attached to this class",
        )
    if course_class.status != "active":
        raise HTTPException(
            status_code=409,
            detail="Course attachment is not active",
        )
    unit = db.scalar(
        select(CourseUnit)
        .where(CourseUnit.id == unit_id, CourseUnit.course_id == course.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if unit is None:
        raise HTTPException(status_code=404, detail="Course unit not found")
    plan = db.scalar(
        select(CourseUnitClassPlan)
        .where(
            CourseUnitClassPlan.course_class_id == course_class.id,
            CourseUnitClassPlan.course_unit_id == unit.id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if plan is None:
        raise HTTPException(
            status_code=409,
            detail="Course release plan is inconsistent",
        )
    return LockedUnitReleaseScope(
        course_class=course_class,
        unit=unit,
        plan=plan,
    )


def require_unit_release_open_for_write(
    db: Session,
    *,
    course: Course,
    class_group: ClassGroup,
    scope: LockedUnitReleaseScope,
    subject_user_id: int,
) -> EffectiveUnitAccess:
    """Evaluate current access without requiring the subject's membership row."""
    completed_unit_ids = None
    if scope.plan.prerequisite_unit_id is not None:
        completed_unit_ids = authoritative_prerequisite_unit_ids(
            db,
            subject_user_id=subject_user_id,
            class_id=class_group.id,
            course_id=course.id,
            locking_read=True,
        )
    access = effective_unit_access(
        db,
        course=course,
        class_group=class_group,
        unit=scope.unit,
        plan=scope.plan,
        student_id=subject_user_id,
        completed_unit_ids=completed_unit_ids,
    )
    if access.state == "hidden":
        raise HTTPException(
            status_code=403,
            detail="Course unit is not visible in this class",
        )
    if access.state != "open":
        raise HTTPException(
            status_code=409,
            detail="Course unit is locked in this class",
        )
    return access


def require_student_unit_open_for_write(
    db: Session,
    *,
    course: Course,
    class_group: ClassGroup,
    unit: CourseUnit,
    student_id: int,
) -> ClassGroup:
    """Lock and validate a student write in the global mutation order.

    Order: school -> course -> class -> membership -> course-class -> unit ->
    plan/prerequisite evidence. Release-plan PATCH shares the school -> class
    -> course-class subsequence, so both paths serialize before plan decisions.
    """
    locked_course = lock_course_for_write(db, course.id)
    locked_class = lock_active_class_for_write(
        db,
        class_group.id,
        expected_school_id=locked_course.school_id,
    )
    active_membership = db.scalar(
        active_student_membership_statement(
            locked_class.id,
            student_id,
            locking_read=True,
        )
    )
    if active_membership is None:
        raise HTTPException(
            status_code=403,
            detail="Class is outside current student scope",
        )
    scope = lock_unit_release_scope_for_write(
        db,
        course=locked_course,
        class_group=locked_class,
        unit_id=unit.id,
    )
    require_unit_release_open_for_write(
        db,
        course=locked_course,
        class_group=locked_class,
        scope=scope,
        subject_user_id=student_id,
    )
    return locked_class
