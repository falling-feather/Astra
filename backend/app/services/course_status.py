from __future__ import annotations

from contextlib import nullcontext
from threading import RLock

from fastapi import HTTPException, Request
from sqlalchemy import func, select, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.models import Assignment, Course, CourseClass, CourseUnit, User
from app.schemas.course_status import CourseStatusPatch
from app.services.access_control import lock_course_for_write
from app.services.admin_common import lock_active_admin, require_admin
from app.services.audit import record_audit_log
from app.services.security_control_locks import (
    ADMIN_AUTHORITY_LOCK,
    acquire_security_control_lock,
)


_ALLOWED_TRANSITIONS = {
    "draft": {"published", "archived"},
    "published": {"draft", "archived"},
    "archived": {"draft"},
}
_SQLITE_COURSE_STATUS_WRITE_LOCK = RLock()


def update_course_status(
    db: Session,
    *,
    actor: User,
    course_id: int,
    payload: CourseStatusPatch,
    request: Request | None = None,
) -> dict:
    require_admin(actor)
    is_sqlite = db.get_bind().dialect.name == "sqlite"
    write_lock = _SQLITE_COURSE_STATUS_WRITE_LOCK if is_sqlite else nullcontext()
    with write_lock:
        try:
            return _update_course_status_locked(
                db,
                actor=actor,
                course_id=course_id,
                payload=payload,
                request=request,
            )
        except OperationalError as exc:
            db.rollback()
            if is_sqlite and _is_sqlite_lock_conflict(exc):
                raise HTTPException(
                    status_code=409,
                    detail="Course status changed; reload and retry",
                ) from None
            raise


def _update_course_status_locked(
    db: Session,
    *,
    actor: User,
    course_id: int,
    payload: CourseStatusPatch,
    request: Request | None,
) -> dict:
    acquire_security_control_lock(db, ADMIN_AUTHORITY_LOCK)
    course = lock_course_for_write(db, course_id)
    actor = lock_active_admin(db, actor.id)
    current_status = course.status
    if current_status != payload.expected_status:
        raise HTTPException(
            status_code=409,
            detail="Course status changed; reload and retry",
        )
    if payload.status == current_status:
        raise HTTPException(
            status_code=409,
            detail="Course is already in requested status",
        )
    if payload.status not in _ALLOWED_TRANSITIONS.get(current_status, set()):
        raise HTTPException(
            status_code=409,
            detail="Course status transition is not allowed",
        )

    impact = _course_status_impact(db, course.id)
    before = _course_snapshot(course, status=current_status)
    status_update = db.execute(
        update(Course)
        .where(
            Course.id == course.id,
            Course.status == payload.expected_status,
        )
        .values(status=payload.status)
        .execution_options(synchronize_session=False)
    )
    if status_update.rowcount != 1:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Course status changed; reload and retry",
        )

    after = {**before, "status": payload.status}
    record_audit_log(
        db,
        actor=actor,
        action="course.status.patch",
        resource_type="course",
        resource_id=course.id,
        school_id=course.school_id,
        event_result="success",
        request=request,
        snapshot={
            "before": before,
            "after": after,
            "reason": payload.reason,
            "impact": impact,
        },
    )
    db.commit()
    db.refresh(course)
    return {"course": course, "impact": impact}


def _is_sqlite_lock_conflict(exc: OperationalError) -> bool:
    message = str(getattr(exc, "orig", exc)).lower()
    return any(
        marker in message
        for marker in (
            "database is locked",
            "database table is locked",
            "database is busy",
        )
    )


def _course_status_impact(db: Session, course_id: int) -> dict[str, int]:
    attached_class_count = int(
        db.scalar(
            select(func.count())
            .select_from(CourseClass)
            .where(
                CourseClass.course_id == course_id,
                CourseClass.status == "active",
            )
        )
        or 0
    )
    course_unit_count = int(
        db.scalar(
            select(func.count())
            .select_from(CourseUnit)
            .where(CourseUnit.course_id == course_id)
        )
        or 0
    )
    assignment_count = int(
        db.scalar(
            select(func.count())
            .select_from(Assignment)
            .join(CourseUnit, CourseUnit.id == Assignment.unit_id)
            .where(CourseUnit.course_id == course_id)
        )
        or 0
    )
    return {
        "attached_class_count": attached_class_count,
        "course_unit_count": course_unit_count,
        "assignment_count": assignment_count,
    }


def _course_snapshot(course: Course, *, status: str) -> dict:
    return {
        "id": course.id,
        "school_id": course.school_id,
        "creator_user_id": course.creator_user_id,
        "galaxy_key": course.galaxy_key,
        "course_key": course.course_key,
        "title": course.title,
        "summary": course.summary,
        "status": status,
    }
