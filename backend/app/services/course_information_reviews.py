from __future__ import annotations

import secrets
from typing import Any

from fastapi import HTTPException, Request
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    ClassGroup,
    Course,
    CourseAdmissionClass,
    CourseClass,
    CourseCollaborator,
    CourseInformationRevision,
    CourseRelease,
    SchoolMembership,
    User,
)
from app.models.base import utc_now
from app.schemas.course_authoring import CourseDraftCreate
from app.services.admin_common import lock_active_admin, next_offset, require_admin
from app.services.audit import record_audit_log
from app.services.security_control_locks import (
    ADMIN_AUTHORITY_LOCK,
    acquire_security_control_lock,
)

REVISION_STATUSES = {"draft", "submitted", "approved", "rejected"}
COURSE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
COURSE_CODE_LENGTH = 8
COURSE_CODE_ATTEMPTS = 32


def list_information_revisions(
    db: Session,
    *,
    admin: User,
    status_filter: str | None,
    school_id: int | None,
    limit: int,
    offset: int,
) -> tuple[list[dict], int, int | None]:
    require_admin(admin)
    statement = (
        select(CourseInformationRevision)
        .join(Course, Course.id == CourseInformationRevision.course_id)
        .order_by(CourseInformationRevision.id.desc())
    )
    if status_filter is not None:
        normalized_status = status_filter.strip().lower()
        if normalized_status not in REVISION_STATUSES:
            raise HTTPException(
                status_code=422, detail="Unsupported course information revision status"
            )
        statement = statement.where(
            CourseInformationRevision.status == normalized_status
        )
    if school_id is not None:
        statement = statement.where(Course.school_id == school_id)

    total = int(
        db.scalar(select(func.count()).select_from(statement.order_by(None).subquery()))
        or 0
    )
    revisions = list(db.scalars(statement.offset(offset).limit(limit)).all())
    items = [build_information_review_read(db, revision) for revision in revisions]
    return items, total, next_offset(total, offset, len(items))


def review_information_revision(
    db: Session,
    *,
    revision_id: int,
    reviewer: User,
    decision: str,
    note: str | None,
    request: Request | None = None,
) -> dict:
    if decision not in {"approved", "rejected"}:
        raise HTTPException(
            status_code=422, detail="Unsupported course information revision decision"
        )

    acquire_security_control_lock(db, ADMIN_AUTHORITY_LOCK)
    reviewer = lock_active_admin(db, reviewer.id)
    revision = db.scalar(
        select(CourseInformationRevision)
        .where(CourseInformationRevision.id == revision_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if revision is None:
        raise HTTPException(
            status_code=404, detail="Course information revision not found"
        )
    if revision.status != "submitted":
        raise HTTPException(
            status_code=409,
            detail="Course information revision has already been reviewed",
        )

    course = db.scalar(
        select(Course)
        .where(Course.id == revision.course_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if course is None:
        raise HTTPException(
            status_code=409, detail="Course information revision course is unavailable"
        )
    if decision == "approved" and course.status == "archived":
        raise HTTPException(
            status_code=409, detail="Archived course information cannot be approved"
        )

    before = {
        "revision_status": revision.status,
        "course_status": course.status,
        "course_code": course.course_code,
        "current_information_revision_id": course.current_information_revision_id,
    }
    internal_scope = _internal_scope_ids(db, course.id)
    if decision == "approved":
        internal_scope = _approve_information_revision(
            db, course=course, revision=revision
        )

    now = utc_now()
    revision.status = decision
    revision.reviewed_by_user_id = reviewer.id
    revision.reviewed_at = now
    revision.review_note = _trim_optional(note)
    course.updated_at = now
    has_published_content, content_status, content_status_label = _content_publication_status(
        db,
        course.id,
    )
    record_audit_log(
        db,
        actor=reviewer,
        action=(
            "course.information_revision.approve"
            if decision == "approved"
            else "course.information_revision.reject"
        ),
        resource_type="course_information_revision",
        resource_id=revision.id,
        school_id=course.school_id,
        event_result="success",
        request=request,
        snapshot={
            "before": before,
            "after": {
                "revision_status": revision.status,
                "course_status": course.status,
                "course_code": course.course_code,
                "current_information_revision_id": course.current_information_revision_id,
                "internal_class_id": internal_scope[0],
                "internal_course_class_id": internal_scope[1],
                "has_published_content": has_published_content,
                "content_status": content_status,
                "content_status_label": content_status_label,
                "reviewed_by_user_id": reviewer.id,
                "has_review_note": revision.review_note is not None,
            },
        },
    )
    db.commit()
    db.refresh(course)
    db.refresh(revision)
    return build_information_review_read(db, revision, course=course)


def build_information_review_read(
    db: Session,
    revision: CourseInformationRevision,
    *,
    course: Course | None = None,
) -> dict:
    course = course or db.get(Course, revision.course_id)
    if course is None:
        raise HTTPException(
            status_code=409, detail="Course information revision course is unavailable"
        )

    current_revision = (
        db.get(CourseInformationRevision, course.current_information_revision_id)
        if course.current_information_revision_id is not None
        else None
    )
    proposed_information = dict(revision.information_snapshot or {})
    current_information = (
        dict(current_revision.information_snapshot or {})
        if current_revision is not None
        else None
    )
    proposed_teacher_ids = _normalized_id_list(
        revision.teacher_ids_snapshot,
        detail="Course information revision teacher snapshot is invalid",
    )
    current_teacher_ids = (
        _normalized_id_list(
            current_revision.teacher_ids_snapshot,
            detail="Current course teacher snapshot is invalid",
        )
        if current_revision is not None
        else []
    )
    proposed_class_ids = _snapshot_class_ids(proposed_information)
    current_class_ids = _snapshot_class_ids(current_information or {})
    changed_fields = {
        key
        for key in set(proposed_information) | set(current_information or {})
        if proposed_information.get(key) != (current_information or {}).get(key)
    }
    if proposed_teacher_ids != current_teacher_ids:
        changed_fields.add("teacher_ids")
    internal_class_id, internal_course_class_id = _internal_scope_ids(db, course.id)
    has_published_content, content_status, content_status_label = _content_publication_status(
        db,
        course.id,
    )

    return {
        "revision": revision,
        "course_id": course.id,
        "school_id": course.school_id,
        "course_status": course.status,
        "course_code": course.course_code,
        "current_information_revision_id": course.current_information_revision_id,
        "proposed_information": proposed_information,
        "current_information": current_information,
        "changed_fields": sorted(changed_fields),
        "proposed_teachers": _teacher_reads(
            db,
            teacher_ids=proposed_teacher_ids,
            creator_user_id=course.creator_user_id,
        ),
        "current_teachers": _teacher_reads(
            db,
            teacher_ids=current_teacher_ids,
            creator_user_id=course.creator_user_id,
        ),
        "proposed_admission_classes": _class_reads(db, proposed_class_ids),
        "current_admission_classes": _class_reads(db, current_class_ids),
        "internal_class_id": internal_class_id,
        "internal_course_class_id": internal_course_class_id,
        "has_published_content": has_published_content,
        "content_status": content_status,
        "content_status_label": content_status_label,
    }


def _content_publication_status(db: Session, course_id: int) -> tuple[bool, str, str]:
    latest_release_number = db.scalar(
        select(func.max(CourseRelease.release_number)).where(CourseRelease.course_id == course_id)
    )
    if latest_release_number is None:
        return False, "not_published", "暂无已发布内容"
    return True, "published", f"已发布第 {int(latest_release_number)} 版"


def _approve_information_revision(
    db: Session,
    *,
    course: Course,
    revision: CourseInformationRevision,
) -> tuple[int, int]:
    payload, teacher_ids = _validated_revision_payload(course, revision)
    duplicate_title = db.scalar(
        select(Course.id).where(
            Course.school_id == course.school_id,
            Course.title == payload.title,
            Course.id != course.id,
        )
    )
    if duplicate_title is not None:
        raise HTTPException(
            status_code=409, detail="Course already exists in this school"
        )

    teachers = _lock_eligible_teachers(
        db,
        school_id=course.school_id,
        teacher_ids=teacher_ids,
    )
    admission_classes = _lock_admission_classes(
        db,
        school_id=course.school_id,
        class_ids=payload.admission_class_ids,
    )
    _apply_course_information(course, payload)
    _sync_course_collaborators(
        db,
        course=course,
        teachers=teachers,
    )
    _sync_course_admission_classes(
        db,
        course=course,
        admission_classes=admission_classes,
    )
    if course.course_code is None:
        course.course_code = _generate_unique_course_code(db)
    internal_scope = _ensure_internal_course_scope(db, course)
    course.current_information_revision_id = revision.id
    course.status = "published"
    return internal_scope


def _validated_revision_payload(
    course: Course,
    revision: CourseInformationRevision,
) -> tuple[CourseDraftCreate, list[int]]:
    teacher_ids = _normalized_id_list(
        revision.teacher_ids_snapshot,
        detail="Course information revision teacher snapshot is invalid",
    )
    if course.creator_user_id not in teacher_ids:
        raise HTTPException(
            status_code=409,
            detail="Course information revision must retain the course creator",
        )
    collaborator_user_ids = sorted(
        user_id for user_id in teacher_ids if user_id != course.creator_user_id
    )
    try:
        payload = CourseDraftCreate.model_validate(
            {
                **dict(revision.information_snapshot or {}),
                "school_id": course.school_id,
                "collaborator_user_ids": collaborator_user_ids,
            }
        )
    except ValidationError as exc:
        raise HTTPException(
            status_code=409,
            detail="Course information revision snapshot is invalid",
        ) from exc
    return payload, teacher_ids


def _lock_eligible_teachers(
    db: Session,
    *,
    school_id: int,
    teacher_ids: list[int],
) -> list[User]:
    teachers = list(
        db.scalars(
            select(User)
            .where(User.id.in_(teacher_ids))
            .order_by(User.id)
            .with_for_update()
        ).all()
    )
    if len(teachers) != len(teacher_ids) or any(
        teacher.status != "active" or teacher.role != "teacher" for teacher in teachers
    ):
        raise HTTPException(
            status_code=409, detail="Course teacher is no longer eligible"
        )
    member_ids = set(
        db.scalars(
            select(SchoolMembership.user_id).where(
                SchoolMembership.school_id == school_id,
                SchoolMembership.user_id.in_(teacher_ids),
                SchoolMembership.role.in_(["admin", "teacher"]),
                SchoolMembership.status == "active",
            )
        ).all()
    )
    if member_ids != set(teacher_ids):
        raise HTTPException(
            status_code=409, detail="Course teacher is outside the course school"
        )
    return teachers


def _lock_admission_classes(
    db: Session,
    *,
    school_id: int,
    class_ids: list[int],
) -> list[ClassGroup]:
    if not class_ids:
        return []
    classes = list(
        db.scalars(
            select(ClassGroup)
            .where(ClassGroup.id.in_(class_ids))
            .order_by(ClassGroup.id)
            .with_for_update()
        ).all()
    )
    if len(classes) != len(class_ids) or any(
        class_group.school_id != school_id
        or class_group.kind != "homeroom"
        or class_group.status != "active"
        for class_group in classes
    ):
        raise HTTPException(
            status_code=409, detail="Course admission class is no longer eligible"
        )
    return classes


def _apply_course_information(course: Course, payload: CourseDraftCreate) -> None:
    course.title = payload.title
    course.summary = payload.summary
    course.academic_year = payload.academic_year
    course.schedule_text = payload.schedule_text
    course.total_hours = payload.total_hours
    course.galaxy_key = payload.galaxy_key
    course.subject_key = payload.subject_key
    course.admission_mode = payload.admission_mode


def _sync_course_collaborators(
    db: Session,
    *,
    course: Course,
    teachers: list[User],
) -> None:
    target_ids = {
        teacher.id for teacher in teachers if teacher.id != course.creator_user_id
    }
    rows = list(
        db.scalars(
            select(CourseCollaborator)
            .where(CourseCollaborator.course_id == course.id)
            .order_by(CourseCollaborator.id)
            .with_for_update()
        ).all()
    )
    row_by_user_id = {row.user_id: row for row in rows}
    for row in rows:
        row.status = "active" if row.user_id in target_ids else "inactive"
        if row.user_id in target_ids:
            row.role = "editor"
    for user_id in sorted(target_ids - set(row_by_user_id)):
        db.add(
            CourseCollaborator(
                course_id=course.id,
                user_id=user_id,
                role="editor",
                status="active",
            )
        )


def _sync_course_admission_classes(
    db: Session,
    *,
    course: Course,
    admission_classes: list[ClassGroup],
) -> None:
    target_ids = {class_group.id for class_group in admission_classes}
    rows = list(
        db.scalars(
            select(CourseAdmissionClass)
            .where(CourseAdmissionClass.course_id == course.id)
            .order_by(CourseAdmissionClass.id)
            .with_for_update()
        ).all()
    )
    row_by_class_id = {row.class_id: row for row in rows}
    for row in rows:
        row.status = "active" if row.class_id in target_ids else "inactive"
    for class_id in sorted(target_ids - set(row_by_class_id)):
        db.add(
            CourseAdmissionClass(
                course_id=course.id,
                class_id=class_id,
                status="active",
            )
        )


def _ensure_internal_course_scope(db: Session, course: Course) -> tuple[int, int]:
    rows = list(
        db.execute(
            select(CourseClass, ClassGroup)
            .join(ClassGroup, ClassGroup.id == CourseClass.class_id)
            .where(
                CourseClass.course_id == course.id,
                ClassGroup.kind == "course_cohort",
            )
            .order_by(CourseClass.id)
            .with_for_update()
        ).all()
    )
    if len(rows) > 1:
        raise HTTPException(
            status_code=409, detail="Course has multiple internal teaching scopes"
        )
    if rows:
        course_class, class_group = rows[0]
        if class_group.school_id != course.school_id:
            raise HTTPException(
                status_code=409, detail="Course internal teaching scope is invalid"
            )
        class_group.status = "active"
        course_class.status = "active"
        return class_group.id, course_class.id

    class_group = ClassGroup(
        school_id=course.school_id,
        name=f"课程群组 · {course.course_code}",
        kind="course_cohort",
        description="系统为授课课程自动创建的内部学习群组",
        status="active",
        version=1,
    )
    db.add(class_group)
    db.flush()
    course_class = CourseClass(
        course_id=course.id,
        class_id=class_group.id,
        status="active",
        plan_version=1,
    )
    db.add(course_class)
    db.flush()
    return class_group.id, course_class.id


def _generate_unique_course_code(db: Session) -> str:
    for _ in range(COURSE_CODE_ATTEMPTS):
        candidate = _new_course_code_candidate()
        existing = db.scalar(select(Course.id).where(Course.course_code == candidate))
        if existing is None:
            return candidate
    raise HTTPException(
        status_code=503, detail="Unable to allocate a unique course code"
    )


def _new_course_code_candidate() -> str:
    return "".join(
        secrets.choice(COURSE_CODE_ALPHABET) for _ in range(COURSE_CODE_LENGTH)
    )


def _internal_scope_ids(db: Session, course_id: int) -> tuple[int | None, int | None]:
    rows = list(
        db.execute(
            select(CourseClass.id, ClassGroup.id)
            .join(ClassGroup, ClassGroup.id == CourseClass.class_id)
            .where(
                CourseClass.course_id == course_id,
                ClassGroup.kind == "course_cohort",
            )
            .order_by(CourseClass.id)
        ).all()
    )
    if len(rows) > 1:
        raise HTTPException(
            status_code=409, detail="Course has multiple internal teaching scopes"
        )
    if not rows:
        return None, None
    course_class_id, class_id = rows[0]
    return class_id, course_class_id


def _teacher_reads(
    db: Session,
    *,
    teacher_ids: list[int],
    creator_user_id: int,
) -> list[dict]:
    if not teacher_ids:
        return []
    users = list(db.scalars(select(User).where(User.id.in_(teacher_ids))).all())
    user_by_id = {user.id: user for user in users}
    return [
        {
            "user_id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "role": user.role,
            "is_creator": user.id == creator_user_id,
        }
        for user_id in teacher_ids
        if (user := user_by_id.get(user_id)) is not None
    ]


def _class_reads(db: Session, class_ids: list[int]) -> list[dict]:
    if not class_ids:
        return []
    classes = list(
        db.scalars(
            select(ClassGroup)
            .where(ClassGroup.id.in_(class_ids))
            .order_by(ClassGroup.name, ClassGroup.id)
        ).all()
    )
    return [
        {
            "class_id": class_group.id,
            "name": class_group.name,
            "status": class_group.status,
        }
        for class_group in classes
    ]


def _snapshot_class_ids(information: dict[str, Any]) -> list[int]:
    return _normalized_id_list(
        information.get("admission_class_ids", []),
        detail="Course information revision admission class snapshot is invalid",
    )


def _normalized_id_list(value: Any, *, detail: str) -> list[int]:
    if not isinstance(value, list) or any(
        type(item) is not int or item <= 0 for item in value
    ):
        raise HTTPException(status_code=409, detail=detail)
    if len(value) != len(set(value)):
        raise HTTPException(status_code=409, detail=detail)
    return list(value)


def _trim_optional(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None
