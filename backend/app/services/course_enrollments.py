from __future__ import annotations

from contextlib import nullcontext
from threading import RLock

from fastapi import HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    ClassGroup,
    ClassMembership,
    Course,
    CourseAdmissionClass,
    CourseClass,
    CourseCollaborator,
    CourseEnrollment,
    CourseJoinRequest,
    User,
)
from app.models.base import utc_now
from app.services.access_control import (
    get_course,
    lock_course_for_write,
    require_course_collaborator_or_admin,
    require_school_role,
)
from app.services.admin_common import next_offset
from app.services.audit import record_audit_log

JOIN_REQUEST_STATUSES = {"pending", "approved", "rejected"}
ENROLLMENT_STATUSES = {"active", "left"}
_SQLITE_COURSE_ENROLLMENT_WRITE_LOCK = RLock()


def discover_course_by_code(
    db: Session,
    *,
    student: User,
    course_code: str,
) -> dict:
    _require_student(student)
    normalized_code = course_code.strip().upper()
    if not normalized_code:
        raise HTTPException(status_code=404, detail="Course not found")
    course = db.scalar(
        select(Course).where(
            Course.course_code == normalized_code,
            Course.status == "published",
        )
    )
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")

    eligible_classes = _eligible_source_classes(db, course=course, student_id=student.id)
    latest_request = db.scalar(
        select(CourseJoinRequest)
        .where(
            CourseJoinRequest.course_id == course.id,
            CourseJoinRequest.student_id == student.id,
        )
        .order_by(CourseJoinRequest.request_number.desc(), CourseJoinRequest.id.desc())
        .limit(1)
    )
    enrollment = db.scalar(
        select(CourseEnrollment).where(
            CourseEnrollment.course_id == course.id,
            CourseEnrollment.student_id == student.id,
        )
    )

    if enrollment is not None and enrollment.status == "active":
        can_request = False
        reason = "already_enrolled"
    elif latest_request is not None and latest_request.status == "pending":
        can_request = False
        reason = "request_pending"
    elif course.admission_mode == "class_restricted" and not eligible_classes:
        can_request = False
        reason = "class_not_eligible"
    else:
        can_request = True
        reason = "eligible"

    return {
        "course_id": course.id,
        "school_id": course.school_id,
        "course_code": course.course_code,
        "title": course.title,
        "summary": course.summary,
        "galaxy_key": course.galaxy_key,
        "subject_key": course.subject_key,
        "academic_year": course.academic_year,
        "schedule_text": course.schedule_text,
        "total_hours": course.total_hours,
        "admission_mode": course.admission_mode,
        "teachers": _course_teacher_reads(db, course),
        "eligible_source_classes": [_source_class_read(item) for item in eligible_classes],
        "can_request": can_request,
        "eligibility_reason": reason,
        "latest_join_request": (
            build_join_request_read(db, latest_request) if latest_request is not None else None
        ),
        "enrollment": build_enrollment_read(db, enrollment) if enrollment is not None else None,
    }


def create_join_request(
    db: Session,
    *,
    actor: User,
    course_id: int,
    source_class_id: int | None,
    message: str | None,
    request: Request | None = None,
) -> dict:
    with _write_lock(db):
        course = lock_course_for_write(db, course_id)
        actor = _lock_active_student(db, actor.id)
        _require_course_accepting_students(course)

        enrollment = db.scalar(
            select(CourseEnrollment)
            .where(
                CourseEnrollment.course_id == course.id,
                CourseEnrollment.student_id == actor.id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if enrollment is not None and enrollment.status == "active":
            raise HTTPException(status_code=409, detail="Student is already enrolled in this course")

        pending = db.scalar(
            select(CourseJoinRequest)
            .where(
                CourseJoinRequest.course_id == course.id,
                CourseJoinRequest.student_id == actor.id,
                CourseJoinRequest.status == "pending",
            )
            .order_by(CourseJoinRequest.request_number.desc(), CourseJoinRequest.id.desc())
            .limit(1)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if pending is not None:
            return build_join_request_read(db, pending)

        resolved_class = _resolve_request_source_class(
            db,
            course=course,
            student_id=actor.id,
            requested_class_id=source_class_id,
        )
        current_number = int(
            db.scalar(
                select(func.max(CourseJoinRequest.request_number)).where(
                    CourseJoinRequest.course_id == course.id,
                    CourseJoinRequest.student_id == actor.id,
                )
            )
            or 0
        )
        join_request = CourseJoinRequest(
            course_id=course.id,
            student_id=actor.id,
            source_class_id=resolved_class.id if resolved_class is not None else None,
            request_number=current_number + 1,
            message=message,
            status="pending",
        )
        db.add(join_request)
        db.flush()
        record_audit_log(
            db,
            actor=actor,
            action="course.join_request.create",
            resource_type="course_join_request",
            resource_id=join_request.id,
            school_id=course.school_id,
            class_id=join_request.source_class_id,
            event_result="success",
            request=request,
            snapshot={
                "after": {
                    "course_id": course.id,
                    "student_id": actor.id,
                    "source_class_id": join_request.source_class_id,
                    "request_number": join_request.request_number,
                    "status": join_request.status,
                    "has_message": join_request.message is not None,
                }
            },
        )
        db.commit()
        db.refresh(join_request)
        return build_join_request_read(db, join_request)


def list_join_requests(
    db: Session,
    *,
    actor: User,
    course_id: int,
    status_filter: str,
    limit: int,
    offset: int,
) -> tuple[list[dict], int, int | None]:
    course = get_course(db, course_id)
    _require_course_teacher_or_admin(db, actor=actor, course=course)
    normalized_status = status_filter.strip().lower()
    if normalized_status not in {*JOIN_REQUEST_STATUSES, "all"}:
        raise HTTPException(status_code=422, detail="Unsupported course join request status")
    statement = select(CourseJoinRequest).where(CourseJoinRequest.course_id == course.id)
    if normalized_status != "all":
        statement = statement.where(CourseJoinRequest.status == normalized_status)
    statement = statement.order_by(CourseJoinRequest.id.desc())
    total = int(
        db.scalar(select(func.count()).select_from(statement.order_by(None).subquery())) or 0
    )
    rows = list(db.scalars(statement.offset(offset).limit(limit)).all())
    items = [build_join_request_read(db, item) for item in rows]
    return items, total, next_offset(total, offset, len(items))


def review_join_request(
    db: Session,
    *,
    actor: User,
    course_id: int,
    join_request_id: int,
    decision: str,
    note: str | None,
    request: Request | None = None,
) -> dict:
    if decision not in {"approved", "rejected"}:
        raise HTTPException(status_code=422, detail="Unsupported course join request decision")
    with _write_lock(db):
        course = lock_course_for_write(db, course_id)
        actor = _lock_active_actor(db, actor.id)
        _require_course_teacher_or_admin(db, actor=actor, course=course, locking_read=True)
        join_request = db.scalar(
            select(CourseJoinRequest)
            .where(
                CourseJoinRequest.id == join_request_id,
                CourseJoinRequest.course_id == course.id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if join_request is None:
            raise HTTPException(status_code=404, detail="Course join request not found")
        if join_request.status != "pending":
            raise HTTPException(status_code=409, detail="Course join request has already been reviewed")

        student = _lock_active_student(db, join_request.student_id)
        enrollment = None
        enrollment_outcome = None
        if decision == "approved":
            _require_course_accepting_students(course)
            resolved_class = _revalidate_join_request_source(
                db,
                course=course,
                student_id=student.id,
                source_class_id=join_request.source_class_id,
            )
            enrollment, enrollment_outcome = _activate_enrollment(
                db,
                course=course,
                student=student,
                source_class=resolved_class,
                source="request",
            )
            _ensure_internal_student_membership(db, course=course, student=student)

        before_status = join_request.status
        join_request.status = decision
        join_request.reviewed_by_user_id = actor.id
        join_request.reviewed_at = utc_now()
        join_request.review_note = note
        record_audit_log(
            db,
            actor=actor,
            action=(
                "course.join_request.approve"
                if decision == "approved"
                else "course.join_request.reject"
            ),
            resource_type="course_join_request",
            resource_id=join_request.id,
            school_id=course.school_id,
            class_id=join_request.source_class_id,
            event_result="success",
            request=request,
            snapshot={
                "before": {"status": before_status},
                "after": {
                    "status": join_request.status,
                    "reviewed_by_user_id": actor.id,
                    "has_review_note": note is not None,
                    "enrollment_id": enrollment.id if enrollment is not None else None,
                    "enrollment_outcome": enrollment_outcome,
                },
                "course_id": course.id,
                "student_id": student.id,
            },
        )
        db.commit()
        db.refresh(join_request)
        return build_join_request_read(db, join_request)


def list_enrollments(
    db: Session,
    *,
    actor: User,
    course_id: int,
    status_filter: str,
    limit: int,
    offset: int,
) -> tuple[list[dict], int, int | None]:
    course = get_course(db, course_id)
    _require_course_teacher_or_admin(db, actor=actor, course=course)
    normalized_status = status_filter.strip().lower()
    if normalized_status not in {*ENROLLMENT_STATUSES, "all"}:
        raise HTTPException(status_code=422, detail="Unsupported course enrollment status")
    statement = select(CourseEnrollment).where(CourseEnrollment.course_id == course.id)
    if normalized_status != "all":
        statement = statement.where(CourseEnrollment.status == normalized_status)
    statement = statement.order_by(CourseEnrollment.id)
    total = int(
        db.scalar(select(func.count()).select_from(statement.order_by(None).subquery())) or 0
    )
    rows = list(db.scalars(statement.offset(offset).limit(limit)).all())
    items = [build_enrollment_read(db, item) for item in rows]
    return items, total, next_offset(total, offset, len(items))


def batch_enroll_class(
    db: Session,
    *,
    actor: User,
    course_id: int,
    class_id: int,
    request: Request | None = None,
) -> dict:
    with _write_lock(db):
        course = lock_course_for_write(db, course_id)
        actor = _lock_active_actor(db, actor.id)
        _require_course_teacher_or_admin(db, actor=actor, course=course, locking_read=True)
        _require_course_accepting_students(course)
        class_group = _lock_batch_source_class(db, course=course, class_id=class_id)
        member_rows = list(
            db.execute(
                select(ClassMembership, User)
                .join(User, User.id == ClassMembership.user_id)
                .where(
                    ClassMembership.class_id == class_group.id,
                    ClassMembership.role == "student",
                )
                .order_by(User.display_name, User.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            ).all()
        )
        existing_enrollments = {
            item.student_id: item
            for item in db.scalars(
                select(CourseEnrollment)
                .where(
                    CourseEnrollment.course_id == course.id,
                    CourseEnrollment.student_id.in_([user.id for _, user in member_rows]),
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            ).all()
        } if member_rows else {}

        results: list[dict] = []
        created_count = 0
        already_enrolled_count = 0
        previously_left_count = 0
        ineligible_count = 0
        for membership, student in member_rows:
            existing = existing_enrollments.get(student.id)
            if membership.status != "active" or student.status != "active" or student.role != "student":
                ineligible_count += 1
                results.append(_batch_result(student, "student_not_eligible"))
                continue
            if existing is not None and existing.status == "active":
                already_enrolled_count += 1
                results.append(
                    _batch_result(
                        student,
                        "already_enrolled",
                        enrollment=build_enrollment_read(db, existing),
                    )
                )
                continue
            if existing is not None and existing.status == "left":
                previously_left_count += 1
                results.append(
                    _batch_result(
                        student,
                        "previously_left",
                        enrollment=build_enrollment_read(db, existing),
                    )
                )
                continue

            enrollment, _ = _activate_enrollment(
                db,
                course=course,
                student=student,
                source_class=class_group,
                source="class_batch",
            )
            _ensure_internal_student_membership(db, course=course, student=student)
            pending_request = _latest_pending_request(db, course.id, student.id)
            request_status = None
            if pending_request is not None:
                pending_request.status = "approved"
                pending_request.reviewed_by_user_id = actor.id
                pending_request.reviewed_at = utc_now()
                pending_request.review_note = "approved by class batch enrollment"
                request_status = pending_request.status
            db.flush()
            created_count += 1
            results.append(
                _batch_result(
                    student,
                    "created",
                    enrollment=build_enrollment_read(db, enrollment),
                    join_request_status=request_status,
                )
            )

        record_audit_log(
            db,
            actor=actor,
            action="course.enrollment.class_batch",
            resource_type="course",
            resource_id=course.id,
            school_id=course.school_id,
            class_id=class_group.id,
            event_result="success",
            request=request,
            snapshot={
                "course_id": course.id,
                "class_id": class_group.id,
                "created_count": created_count,
                "already_enrolled_count": already_enrolled_count,
                "previously_left_count": previously_left_count,
                "ineligible_count": ineligible_count,
                "student_ids": [item["student_id"] for item in results],
            },
        )
        db.commit()
        return {
            "class_id": class_group.id,
            "class_name": class_group.name,
            "items": results,
            "created_count": created_count,
            "already_enrolled_count": already_enrolled_count,
            "previously_left_count": previously_left_count,
            "ineligible_count": ineligible_count,
        }


def leave_enrollment(
    db: Session,
    *,
    actor: User,
    course_id: int,
    enrollment_id: int,
    note: str | None,
    request: Request | None = None,
) -> dict:
    with _write_lock(db):
        course = lock_course_for_write(db, course_id)
        actor = _lock_active_actor(db, actor.id)
        enrollment = db.scalar(
            select(CourseEnrollment)
            .where(
                CourseEnrollment.id == enrollment_id,
                CourseEnrollment.course_id == course.id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if enrollment is None:
            raise HTTPException(status_code=404, detail="Course enrollment not found")
        if actor.role == "student":
            if enrollment.student_id != actor.id:
                raise HTTPException(status_code=403, detail="Students can only leave their own course")
        else:
            _require_course_teacher_or_admin(db, actor=actor, course=course, locking_read=True)
        if enrollment.status != "active":
            raise HTTPException(status_code=409, detail="Course enrollment is already inactive")

        before_status = enrollment.status
        enrollment.status = "left"
        internal_class = _internal_course_class(db, course.id, locking_read=True)
        membership = db.scalar(
            select(ClassMembership)
            .where(
                ClassMembership.class_id == internal_class.id,
                ClassMembership.user_id == enrollment.student_id,
                ClassMembership.role == "student",
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if membership is not None:
            membership.status = "inactive"
        record_audit_log(
            db,
            actor=actor,
            action=(
                "course.enrollment.leave"
                if actor.id == enrollment.student_id
                else "course.enrollment.remove"
            ),
            resource_type="course_enrollment",
            resource_id=enrollment.id,
            school_id=course.school_id,
            class_id=enrollment.source_class_id,
            event_result="success",
            request=request,
            snapshot={
                "before": {"status": before_status},
                "after": {
                    "status": enrollment.status,
                    "internal_membership_status": membership.status if membership is not None else None,
                },
                "course_id": course.id,
                "student_id": enrollment.student_id,
                "has_note": note is not None,
            },
        )
        db.commit()
        db.refresh(enrollment)
        return build_enrollment_read(db, enrollment)


def build_join_request_read(db: Session, join_request: CourseJoinRequest) -> dict:
    student = db.get(User, join_request.student_id)
    if student is None:
        raise HTTPException(status_code=409, detail="Course join request student is unavailable")
    source_class = (
        db.get(ClassGroup, join_request.source_class_id)
        if join_request.source_class_id is not None
        else None
    )
    return {
        "id": join_request.id,
        "course_id": join_request.course_id,
        "student_id": student.id,
        "username": student.username,
        "display_name": student.display_name,
        "user_status": student.status,
        "source_class_id": source_class.id if source_class is not None else None,
        "source_class_name": source_class.name if source_class is not None else "未关联班级",
        "request_number": join_request.request_number,
        "message": join_request.message,
        "status": join_request.status,
        "reviewed_by_user_id": join_request.reviewed_by_user_id,
        "reviewed_at": join_request.reviewed_at,
        "review_note": join_request.review_note,
        "created_at": join_request.created_at,
        "updated_at": join_request.updated_at,
    }


def build_enrollment_read(db: Session, enrollment: CourseEnrollment) -> dict:
    student = db.get(User, enrollment.student_id)
    if student is None:
        raise HTTPException(status_code=409, detail="Course enrollment student is unavailable")
    source_class = (
        db.get(ClassGroup, enrollment.source_class_id)
        if enrollment.source_class_id is not None
        else None
    )
    return {
        "id": enrollment.id,
        "course_id": enrollment.course_id,
        "student_id": student.id,
        "username": student.username,
        "display_name": student.display_name,
        "user_status": student.status,
        "source_class_id": source_class.id if source_class is not None else None,
        "source_class_name": source_class.name if source_class is not None else "未关联班级",
        "source": enrollment.source,
        "status": enrollment.status,
        "created_at": enrollment.created_at,
        "updated_at": enrollment.updated_at,
    }


def _require_student(user: User) -> None:
    if user.role != "student" or user.status != "active":
        raise HTTPException(status_code=403, detail="Course admission requires an active student")


def _lock_active_student(db: Session, user_id: int) -> User:
    student = db.scalar(
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if student is None or student.status != "active" or student.role != "student":
        raise HTTPException(status_code=403, detail="Course admission requires an active student")
    return student


def _lock_active_actor(db: Session, user_id: int) -> User:
    actor = db.scalar(
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if actor is None or actor.status != "active":
        raise HTTPException(status_code=401, detail="Invalid user")
    return actor


def _require_course_accepting_students(course: Course) -> None:
    if course.status != "published" or course.course_code is None:
        raise HTTPException(status_code=409, detail="Course is not accepting students")


def _require_course_teacher_or_admin(
    db: Session,
    *,
    actor: User,
    course: Course,
    locking_read: bool = False,
) -> None:
    if actor.role == "admin":
        return
    if actor.role != "teacher":
        raise HTTPException(status_code=403, detail="Course roster requires course teacher role")
    require_school_role(
        db,
        actor,
        course.school_id,
        {"admin", "teacher"},
        detail="Course is outside current teacher scope",
    )
    require_course_collaborator_or_admin(
        db,
        actor,
        course,
        {"editor"},
        detail="Course roster requires an active course teacher",
        locking_read=locking_read,
    )


def _eligible_source_classes(
    db: Session,
    *,
    course: Course,
    student_id: int,
) -> list[ClassGroup]:
    statement = (
        select(ClassGroup)
        .join(ClassMembership, ClassMembership.class_id == ClassGroup.id)
        .where(
            ClassGroup.school_id == course.school_id,
            ClassGroup.kind == "homeroom",
            ClassGroup.status == "active",
            ClassMembership.user_id == student_id,
            ClassMembership.role == "student",
            ClassMembership.status == "active",
        )
        .order_by(ClassMembership.id.desc(), ClassGroup.id.desc())
    )
    if course.admission_mode == "class_restricted":
        statement = statement.join(
            CourseAdmissionClass,
            CourseAdmissionClass.class_id == ClassGroup.id,
        ).where(
            CourseAdmissionClass.course_id == course.id,
            CourseAdmissionClass.status == "active",
        )
    return list(db.scalars(statement).unique().all())


def _resolve_request_source_class(
    db: Session,
    *,
    course: Course,
    student_id: int,
    requested_class_id: int | None,
) -> ClassGroup | None:
    eligible = _eligible_source_classes(db, course=course, student_id=student_id)
    by_id = {item.id: item for item in eligible}
    if requested_class_id is not None:
        selected = by_id.get(requested_class_id)
        if selected is None:
            raise HTTPException(status_code=403, detail="Student is not eligible through this class")
        return selected
    if course.admission_mode == "class_restricted":
        if not eligible:
            raise HTTPException(status_code=403, detail="Student is not eligible for this course")
        return eligible[0]
    return eligible[0] if len(eligible) == 1 else None


def _revalidate_join_request_source(
    db: Session,
    *,
    course: Course,
    student_id: int,
    source_class_id: int | None,
) -> ClassGroup | None:
    eligible = _eligible_source_classes(db, course=course, student_id=student_id)
    by_id = {item.id: item for item in eligible}
    if course.admission_mode == "class_restricted":
        if source_class_id is None or source_class_id not in by_id:
            raise HTTPException(status_code=409, detail="Student no longer meets course class admission")
        return by_id[source_class_id]
    if source_class_id is None:
        return None
    return by_id.get(source_class_id)


def _lock_batch_source_class(db: Session, *, course: Course, class_id: int) -> ClassGroup:
    class_group = db.scalar(
        select(ClassGroup)
        .where(ClassGroup.id == class_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if class_group is None:
        raise HTTPException(status_code=404, detail="Class not found")
    if (
        class_group.school_id != course.school_id
        or class_group.kind != "homeroom"
        or class_group.status != "active"
    ):
        raise HTTPException(status_code=409, detail="Class is not eligible for course enrollment")
    if course.admission_mode == "class_restricted":
        relation = db.scalar(
            select(CourseAdmissionClass)
            .where(
                CourseAdmissionClass.course_id == course.id,
                CourseAdmissionClass.class_id == class_group.id,
                CourseAdmissionClass.status == "active",
            )
            .with_for_update()
        )
        if relation is None:
            raise HTTPException(status_code=409, detail="Class is outside course admission scope")
    return class_group


def _activate_enrollment(
    db: Session,
    *,
    course: Course,
    student: User,
    source_class: ClassGroup | None,
    source: str,
) -> tuple[CourseEnrollment, str]:
    enrollment = db.scalar(
        select(CourseEnrollment)
        .where(
            CourseEnrollment.course_id == course.id,
            CourseEnrollment.student_id == student.id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if enrollment is None:
        enrollment = CourseEnrollment(
            course_id=course.id,
            student_id=student.id,
            source_class_id=source_class.id if source_class is not None else None,
            source=source,
            status="active",
        )
        db.add(enrollment)
        db.flush()
        return enrollment, "created"
    if enrollment.status == "active":
        return enrollment, "unchanged"
    enrollment.source_class_id = source_class.id if source_class is not None else None
    enrollment.source = source
    enrollment.status = "active"
    db.flush()
    return enrollment, "restored"


def _ensure_internal_student_membership(
    db: Session,
    *,
    course: Course,
    student: User,
) -> ClassMembership:
    internal_class = _internal_course_class(db, course.id, locking_read=True)
    membership = db.scalar(
        select(ClassMembership)
        .where(
            ClassMembership.class_id == internal_class.id,
            ClassMembership.user_id == student.id,
            ClassMembership.role == "student",
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if membership is None:
        membership = ClassMembership(
            class_id=internal_class.id,
            user_id=student.id,
            role="student",
            status="active",
        )
        db.add(membership)
    else:
        membership.status = "active"
    db.flush()
    return membership


def _internal_course_class(
    db: Session,
    course_id: int,
    *,
    locking_read: bool,
) -> ClassGroup:
    statement = (
        select(CourseClass, ClassGroup)
        .join(ClassGroup, ClassGroup.id == CourseClass.class_id)
        .where(
            CourseClass.course_id == course_id,
            CourseClass.status == "active",
            ClassGroup.kind == "course_cohort",
            ClassGroup.status == "active",
        )
        .order_by(CourseClass.id)
    )
    if locking_read:
        statement = statement.with_for_update()
    rows = list(db.execute(statement).all())
    if len(rows) != 1:
        raise HTTPException(status_code=409, detail="Course internal teaching scope is unavailable")
    return rows[0][1]


def _latest_pending_request(
    db: Session,
    course_id: int,
    student_id: int,
) -> CourseJoinRequest | None:
    return db.scalar(
        select(CourseJoinRequest)
        .where(
            CourseJoinRequest.course_id == course_id,
            CourseJoinRequest.student_id == student_id,
            CourseJoinRequest.status == "pending",
        )
        .order_by(CourseJoinRequest.request_number.desc(), CourseJoinRequest.id.desc())
        .limit(1)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def _course_teacher_reads(db: Session, course: Course) -> list[dict]:
    collaborator_ids = list(
        db.scalars(
            select(CourseCollaborator.user_id)
            .where(
                CourseCollaborator.course_id == course.id,
                CourseCollaborator.status == "active",
            )
            .order_by(CourseCollaborator.user_id)
        ).all()
    )
    teacher_ids = [course.creator_user_id, *collaborator_ids]
    users = {item.id: item for item in db.scalars(select(User).where(User.id.in_(teacher_ids))).all()}
    return [
        {
            "user_id": user_id,
            "display_name": users[user_id].display_name,
            "is_creator": user_id == course.creator_user_id,
        }
        for user_id in teacher_ids
        if user_id in users
    ]


def _source_class_read(class_group: ClassGroup) -> dict:
    return {
        "class_id": class_group.id,
        "name": class_group.name,
        "grade": class_group.grade,
        "term": class_group.term,
    }


def _batch_result(
    student: User,
    outcome: str,
    *,
    enrollment: dict | None = None,
    join_request_status: str | None = None,
) -> dict:
    return {
        "student_id": student.id,
        "username": student.username,
        "display_name": student.display_name,
        "outcome": outcome,
        "enrollment": enrollment,
        "join_request_status": join_request_status,
    }


def _write_lock(db: Session):
    if db.get_bind().dialect.name == "sqlite":
        return _SQLITE_COURSE_ENROLLMENT_WRITE_LOCK
    return nullcontext()
