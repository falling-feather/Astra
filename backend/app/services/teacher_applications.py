from fastapi import HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.base import utc_now
from app.models.teacher_application import TeacherApplication
from app.models.user import User
from app.schemas.teacher_application import TeacherApplicationRead
from app.services.admin_common import lock_active_admin, next_offset, require_admin
from app.services.audit import record_audit_log
from app.services.security_control_locks import ADMIN_AUTHORITY_LOCK, acquire_security_control_lock


APPLICATION_STATUSES = {"pending", "approved", "rejected"}


def trim_optional(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def has_pending_teacher_application(db: Session, user_id: int) -> bool:
    return db.scalar(
        select(TeacherApplication.id).where(
            TeacherApplication.user_id == user_id,
            TeacherApplication.status == "pending",
        )
    ) is not None


def latest_teacher_application(db: Session, user_id: int) -> TeacherApplication | None:
    return db.scalar(
        select(TeacherApplication)
        .where(TeacherApplication.user_id == user_id)
        .order_by(TeacherApplication.id.desc())
        .limit(1)
    )


def create_teacher_application(
    db: Session,
    *,
    applicant: User,
    message: str | None,
    request: Request,
) -> TeacherApplication:
    acquire_security_control_lock(db, ADMIN_AUTHORITY_LOCK)
    applicant = db.scalar(
        select(User)
        .where(User.id == applicant.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if applicant is None or applicant.status != "active":
        raise HTTPException(status_code=403, detail="Active student account required")
    if applicant.role != "student":
        raise HTTPException(status_code=409, detail="Teacher application requires a student account")
    if has_pending_teacher_application(db, applicant.id):
        raise HTTPException(status_code=409, detail="Teacher application is already pending")

    latest = latest_teacher_application(db, applicant.id)
    if latest is not None and latest.status == "approved":
        raise HTTPException(status_code=409, detail="Teacher application was already approved")

    application = TeacherApplication(
        user_id=applicant.id,
        status="pending",
        message=trim_optional(message),
    )
    db.add(application)
    db.flush()
    record_audit_log(
        db,
        actor=applicant,
        action="teacher.application.create",
        resource_type="teacher_application",
        resource_id=application.id,
        event_result="success",
        request=request,
        snapshot={
            "after": {
                "user_id": applicant.id,
                "status": application.status,
                "has_message": application.message is not None,
            }
        },
    )
    db.commit()
    db.refresh(application)
    return application


def list_teacher_applications(
    db: Session,
    *,
    admin: User,
    status_filter: str | None,
    limit: int,
    offset: int,
) -> tuple[list[TeacherApplicationRead], int, int | None]:
    require_admin(admin)
    statement = (
        select(TeacherApplication, User)
        .join(User, User.id == TeacherApplication.user_id)
        .order_by(TeacherApplication.id.desc())
    )
    if status_filter is not None:
        normalized = status_filter.strip().lower()
        if normalized not in APPLICATION_STATUSES:
            raise HTTPException(status_code=422, detail="Unsupported teacher application status")
        statement = statement.where(TeacherApplication.status == normalized)
    total = int(db.scalar(select(func.count()).select_from(statement.order_by(None).subquery())) or 0)
    rows = db.execute(statement.offset(offset).limit(limit)).all()
    items = [teacher_application_read(application, applicant) for application, applicant in rows]
    return items, total, next_offset(total, offset, len(items))


def review_teacher_application(
    db: Session,
    *,
    application_id: int,
    reviewer: User,
    decision: str,
    note: str | None,
    request: Request,
) -> tuple[TeacherApplication, User]:
    if decision not in {"approved", "rejected"}:
        raise HTTPException(status_code=422, detail="Unsupported teacher application decision")
    acquire_security_control_lock(db, ADMIN_AUTHORITY_LOCK)
    reviewer = lock_active_admin(db, reviewer.id)
    application = db.scalar(
        select(TeacherApplication)
        .where(TeacherApplication.id == application_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if application is None:
        raise HTTPException(status_code=404, detail="Teacher application not found")
    if application.status != "pending":
        raise HTTPException(status_code=409, detail="Teacher application has already been reviewed")

    applicant = db.scalar(
        select(User)
        .where(User.id == application.user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if applicant is None or applicant.status != "active" or applicant.role != "student":
        raise HTTPException(status_code=409, detail="Teacher applicant is no longer eligible")

    before = {"status": application.status, "applicant_role": applicant.role}
    application.status = decision
    application.reviewed_by_user_id = reviewer.id
    application.reviewed_at = utc_now()
    application.review_note = trim_optional(note)
    if decision == "approved":
        applicant.role = "teacher"

    record_audit_log(
        db,
        actor=reviewer,
        action="teacher.application.approve" if decision == "approved" else "teacher.application.reject",
        resource_type="teacher_application",
        resource_id=application.id,
        event_result="success",
        request=request,
        snapshot={
            "before": before,
            "after": {
                "status": application.status,
                "applicant_role": applicant.role,
                "reviewed_by_user_id": reviewer.id,
                "has_review_note": application.review_note is not None,
            },
        },
    )
    db.commit()
    db.refresh(application)
    db.refresh(applicant)
    return application, applicant


def teacher_application_read(application: TeacherApplication, applicant: User) -> TeacherApplicationRead:
    return TeacherApplicationRead(
        id=application.id,
        user_id=application.user_id,
        applicant_username=applicant.username,
        applicant_display_name=applicant.display_name,
        applicant_role=applicant.role,
        status=application.status,
        message=application.message,
        reviewed_by_user_id=application.reviewed_by_user_id,
        reviewed_at=application.reviewed_at,
        review_note=application.review_note,
        created_at=application.created_at,
        updated_at=application.updated_at,
    )


def read_teacher_application(db: Session, application: TeacherApplication) -> TeacherApplicationRead:
    applicant = db.get(User, application.user_id)
    if applicant is None:
        raise HTTPException(status_code=409, detail="Teacher application applicant is unavailable")
    return teacher_application_read(application, applicant)
