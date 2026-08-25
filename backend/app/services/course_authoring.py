from __future__ import annotations

from uuid import uuid4

from fastapi import HTTPException, Request
from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import Session

from app.models import (
    ClassGroup,
    Course,
    CourseAdmissionClass,
    CourseCollaborator,
    CourseInformationRevision,
    CourseRelease,
    SchoolMembership,
    User,
)
from app.models.base import utc_now
from app.schemas.course_authoring import CourseDraftCreate
from app.services.access_control import (
    get_course,
    lock_active_school_for_write,
    lock_scope_eligible_user,
    require_course_collaborator_or_admin,
    require_school_role,
    teacher_school_ids,
)
from app.services.audit import record_audit_log


def create_course_draft(
    db: Session,
    *,
    actor: User,
    payload: CourseDraftCreate,
    request: Request | None = None,
) -> dict:
    actor = _lock_authoring_teacher(db, actor, payload.school_id)
    if actor.id in payload.collaborator_user_ids:
        raise HTTPException(status_code=422, detail="Course creator must not be selected as co-teacher")

    existing_title = db.scalar(
        select(Course.id).where(
            Course.school_id == payload.school_id,
            Course.title == payload.title,
        )
    )
    if existing_title is not None:
        raise HTTPException(status_code=409, detail="Course already exists in this school")

    collaborators = _load_eligible_collaborators(
        db,
        school_id=payload.school_id,
        user_ids=payload.collaborator_user_ids,
    )
    admission_classes = _load_admission_classes(
        db,
        school_id=payload.school_id,
        class_ids=payload.admission_class_ids,
    )

    course = Course(
        school_id=payload.school_id,
        creator_user_id=actor.id,
        galaxy_key=payload.galaxy_key,
        subject_key=payload.subject_key,
        course_key=f"course-{uuid4().hex}",
        title=payload.title,
        summary=payload.summary,
        academic_year=payload.academic_year,
        schedule_text=payload.schedule_text,
        total_hours=payload.total_hours,
        admission_mode=payload.admission_mode,
        status="draft",
    )
    db.add(course)
    db.flush()

    for collaborator in collaborators:
        db.add(
            CourseCollaborator(
                course_id=course.id,
                user_id=collaborator.id,
                role="editor",
                status="active",
            )
        )
    for class_group in admission_classes:
        db.add(
            CourseAdmissionClass(
                course_id=course.id,
                class_id=class_group.id,
                status="active",
            )
        )

    teacher_ids = [actor.id, *sorted(collaborator.id for collaborator in collaborators)]
    information_snapshot = _information_snapshot(payload)
    revision = CourseInformationRevision(
        course_id=course.id,
        revision_number=1,
        information_snapshot=information_snapshot,
        teacher_ids_snapshot=teacher_ids,
        status="draft",
        created_by_user_id=actor.id,
    )
    db.add(revision)
    db.flush()

    record_audit_log(
        db,
        actor=actor,
        action="course.draft.create",
        resource_type="course",
        resource_id=course.id,
        school_id=course.school_id,
        event_result="success",
        request=request,
        snapshot={
            "after": {
                "course_id": course.id,
                "status": course.status,
                "course_code": course.course_code,
                "information_revision_id": revision.id,
                "information_revision_status": revision.status,
                "information": information_snapshot,
                "teacher_ids": teacher_ids,
            }
        },
    )
    db.commit()
    db.refresh(course)
    return build_course_draft_read(db, course)


def list_visible_course_drafts(
    db: Session,
    *,
    actor: User,
    school_id: int | None = None,
) -> list[dict]:
    if actor.role != "teacher":
        raise HTTPException(status_code=403, detail="Course authoring requires teacher role")
    school_ids = teacher_school_ids(db, actor.id)
    if school_id is not None and school_id not in school_ids:
        raise HTTPException(status_code=403, detail="School is outside current teacher scope")
    if not school_ids:
        return []
    collaborator_exists = exists(
        select(CourseCollaborator.id).where(
            CourseCollaborator.course_id == Course.id,
            CourseCollaborator.user_id == actor.id,
            CourseCollaborator.status == "active",
        )
    )
    statement = select(Course).where(
        Course.school_id.in_(school_ids),
        or_(Course.creator_user_id == actor.id, collaborator_exists),
    )

    workflow_revision_exists = exists(
        select(CourseInformationRevision.id).where(
            CourseInformationRevision.course_id == Course.id
        )
    )
    statement = statement.where(workflow_revision_exists)
    if school_id is not None:
        statement = statement.where(Course.school_id == school_id)
    courses = list(db.scalars(statement.order_by(Course.updated_at.desc(), Course.id.desc())).all())
    return [build_course_draft_read(db, course) for course in courses]


def get_course_authoring_options(
    db: Session,
    *,
    actor: User,
    school_id: int,
) -> dict:
    if actor.role != "teacher":
        raise HTTPException(status_code=403, detail="Course authoring requires teacher role")
    require_school_role(
        db,
        actor,
        school_id,
        {"admin", "teacher"},
        detail="Course authoring requires active school teacher membership",
    )
    teachers = list(
        db.scalars(
            select(User)
            .join(SchoolMembership, SchoolMembership.user_id == User.id)
            .where(
                SchoolMembership.school_id == school_id,
                SchoolMembership.role.in_(["admin", "teacher"]),
                SchoolMembership.status == "active",
                User.status == "active",
                User.role == "teacher",
                User.id != actor.id,
            )
            .distinct()
            .order_by(User.display_name, User.id)
        ).all()
    )
    homerooms = list(
        db.scalars(
            select(ClassGroup)
            .where(
                ClassGroup.school_id == school_id,
                ClassGroup.kind == "homeroom",
                ClassGroup.status == "active",
            )
            .order_by(ClassGroup.name, ClassGroup.id)
        ).all()
    )
    return {
        "school_id": school_id,
        "teachers": [
            {
                "user_id": user.id,
                "username": user.username,
                "display_name": user.display_name,
                "role": user.role,
            }
            for user in teachers
        ],
        "homerooms": [
            {
                "class_id": class_group.id,
                "name": class_group.name,
                "grade": class_group.grade,
                "term": class_group.term,
            }
            for class_group in homerooms
        ],
        "admission_modes": ["open", "class_restricted"],
    }


def get_visible_course_draft(db: Session, *, actor: User, course_id: int) -> dict:
    course = get_course(db, course_id)
    _require_course_authoring_access(db, actor=actor, course=course)
    revision = _latest_information_revision(db, course.id)
    if revision is None:
        raise HTTPException(status_code=404, detail="Course authoring draft not found")
    return build_course_draft_read(db, course, revision=revision)


def create_information_revision(
    db: Session,
    *,
    actor: User,
    course_id: int,
    payload: CourseDraftCreate,
    request: Request | None = None,
) -> dict:
    course = db.scalar(
        select(Course)
        .where(Course.id == course_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    _require_course_authoring_access(db, actor=actor, course=course, locking_read=True)
    if course.status == "archived":
        raise HTTPException(status_code=409, detail="Archived course information cannot be revised")
    if payload.school_id != course.school_id:
        raise HTTPException(status_code=422, detail="Course school cannot be changed")
    if course.creator_user_id in payload.collaborator_user_ids:
        raise HTTPException(status_code=422, detail="Course creator must not be selected as co-teacher")

    latest_revision = db.scalar(
        select(CourseInformationRevision)
        .where(CourseInformationRevision.course_id == course.id)
        .order_by(
            CourseInformationRevision.revision_number.desc(),
            CourseInformationRevision.id.desc(),
        )
        .limit(1)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if latest_revision is None:
        raise HTTPException(status_code=409, detail="Course information revision history is unavailable")
    if latest_revision.status in {"draft", "submitted"}:
        raise HTTPException(
            status_code=409,
            detail="Course already has an editable or pending information revision",
        )

    duplicate_title = db.scalar(
        select(Course.id).where(
            Course.school_id == course.school_id,
            Course.title == payload.title,
            Course.id != course.id,
        )
    )
    if duplicate_title is not None:
        raise HTTPException(status_code=409, detail="Course already exists in this school")

    collaborators = _load_eligible_collaborators(
        db,
        school_id=course.school_id,
        user_ids=payload.collaborator_user_ids,
    )
    _load_admission_classes(
        db,
        school_id=course.school_id,
        class_ids=payload.admission_class_ids,
    )
    teacher_ids = [
        course.creator_user_id,
        *sorted(collaborator.id for collaborator in collaborators),
    ]
    information_snapshot = _information_snapshot(payload)
    revision = CourseInformationRevision(
        course_id=course.id,
        revision_number=latest_revision.revision_number + 1,
        information_snapshot=information_snapshot,
        teacher_ids_snapshot=teacher_ids,
        status="draft",
        created_by_user_id=actor.id,
    )
    db.add(revision)
    db.flush()
    record_audit_log(
        db,
        actor=actor,
        action="course.information_revision.create",
        resource_type="course_information_revision",
        resource_id=revision.id,
        school_id=course.school_id,
        event_result="success",
        request=request,
        snapshot={
            "after": {
                "course_id": course.id,
                "revision_number": revision.revision_number,
                "status": revision.status,
                "information": information_snapshot,
                "teacher_ids": teacher_ids,
            },
            "based_on_revision_id": latest_revision.id,
            "current_information_revision_id": course.current_information_revision_id,
        },
    )
    db.commit()
    db.refresh(course)
    db.refresh(revision)
    return build_course_draft_read(db, course, revision=revision)


def submit_information_revision(
    db: Session,
    *,
    actor: User,
    course_id: int,
    revision_id: int,
    request: Request | None = None,
) -> dict:
    course = db.scalar(
        select(Course)
        .where(Course.id == course_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    _require_course_authoring_access(db, actor=actor, course=course, locking_read=True)
    revision = db.scalar(
        select(CourseInformationRevision)
        .where(
            CourseInformationRevision.id == revision_id,
            CourseInformationRevision.course_id == course.id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if revision is None:
        raise HTTPException(status_code=404, detail="Course information revision not found")
    if revision.status != "draft":
        raise HTTPException(status_code=409, detail="Course information revision is not a draft")

    now = utc_now()
    before_status = revision.status
    revision.status = "submitted"
    revision.submitted_at = now
    course.updated_at = now
    record_audit_log(
        db,
        actor=actor,
        action="course.information_revision.submit",
        resource_type="course_information_revision",
        resource_id=revision.id,
        school_id=course.school_id,
        event_result="success",
        request=request,
        snapshot={
            "before": {"status": before_status},
            "after": {"status": revision.status, "submitted_at": now.isoformat()},
            "course_id": course.id,
            "revision_number": revision.revision_number,
        },
    )
    db.commit()
    db.refresh(course)
    db.refresh(revision)
    return build_course_draft_read(db, course, revision=revision)


def build_course_draft_read(
    db: Session,
    course: Course,
    *,
    revision: CourseInformationRevision | None = None,
) -> dict:
    revision = revision or _latest_information_revision(db, course.id)
    if revision is None:
        raise HTTPException(status_code=404, detail="Course information revision not found")

    collaborators = list(
        db.scalars(
            select(CourseCollaborator)
            .where(
                CourseCollaborator.course_id == course.id,
                CourseCollaborator.status == "active",
            )
            .order_by(CourseCollaborator.user_id)
        ).all()
    )
    teacher_ids = [course.creator_user_id, *[item.user_id for item in collaborators]]
    users = list(db.scalars(select(User).where(User.id.in_(teacher_ids))).all())
    user_by_id = {user.id: user for user in users}
    teachers = []
    for user_id in teacher_ids:
        user = user_by_id.get(user_id)
        if user is None:
            continue
        teachers.append(
            {
                "user_id": user.id,
                "username": user.username,
                "display_name": user.display_name,
                "role": user.role,
                "is_creator": user.id == course.creator_user_id,
            }
        )

    admission_rows = list(
        db.execute(
            select(CourseAdmissionClass, ClassGroup)
            .join(ClassGroup, ClassGroup.id == CourseAdmissionClass.class_id)
            .where(
                CourseAdmissionClass.course_id == course.id,
                CourseAdmissionClass.status == "active",
            )
            .order_by(ClassGroup.name, ClassGroup.id)
        ).all()
    )
    has_published_content, content_status, content_status_label = _content_publication_status(
        db,
        course.id,
    )
    return {
        "id": course.id,
        "school_id": course.school_id,
        "creator_user_id": course.creator_user_id,
        "course_code": course.course_code,
        "title": course.title,
        "summary": course.summary,
        "academic_year": course.academic_year,
        "schedule_text": course.schedule_text,
        "total_hours": course.total_hours,
        "galaxy_key": course.galaxy_key,
        "subject_key": course.subject_key,
        "admission_mode": course.admission_mode,
        "current_information_revision_id": course.current_information_revision_id,
        "status": course.status,
        "teachers": teachers,
        "admission_classes": [
            {
                "class_id": class_group.id,
                "name": class_group.name,
                "status": relation.status,
            }
            for relation, class_group in admission_rows
        ],
        "information_revision": revision,
        "has_published_content": has_published_content,
        "content_status": content_status,
        "content_status_label": content_status_label,
        "created_at": course.created_at,
        "updated_at": course.updated_at,
    }


def _content_publication_status(db: Session, course_id: int) -> tuple[bool, str, str]:
    latest_release_number = db.scalar(
        select(func.max(CourseRelease.release_number)).where(CourseRelease.course_id == course_id)
    )
    if latest_release_number is None:
        return False, "not_published", "暂无已发布内容"
    return True, "published", f"已发布第 {int(latest_release_number)} 版"


def _lock_authoring_teacher(db: Session, actor: User, school_id: int) -> User:
    if actor.role != "teacher":
        raise HTTPException(status_code=403, detail="Course authoring requires teacher role")
    require_school_role(
        db,
        actor,
        school_id,
        {"admin", "teacher"},
        detail="Course authoring requires active school teacher membership",
    )
    lock_active_school_for_write(db, school_id)
    actor = lock_scope_eligible_user(
        db,
        actor.id,
        "teacher",
        detail="Course authoring requires active teacher role",
        status_code=403,
    )
    require_school_role(
        db,
        actor,
        school_id,
        {"admin", "teacher"},
        detail="Course authoring requires active school teacher membership",
    )
    return actor


def _require_course_authoring_access(
    db: Session,
    *,
    actor: User,
    course: Course,
    locking_read: bool = False,
) -> None:
    if actor.role != "teacher":
        raise HTTPException(status_code=403, detail="Course authoring requires teacher role")
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
        detail="Course draft is outside current teacher scope",
        locking_read=locking_read,
    )


def _load_eligible_collaborators(
    db: Session,
    *,
    school_id: int,
    user_ids: list[int],
) -> list[User]:
    if not user_ids:
        return []
    users = list(
        db.scalars(
            select(User).where(User.id.in_(user_ids)).order_by(User.id).with_for_update()
        ).all()
    )
    if len(users) != len(user_ids) or any(
        user.status != "active" or user.role != "teacher"
        for user in users
    ):
        raise HTTPException(status_code=422, detail="Selected co-teacher must be an active teacher")
    eligible_ids = set(
        db.scalars(
            select(SchoolMembership.user_id).where(
                SchoolMembership.school_id == school_id,
                SchoolMembership.user_id.in_(user_ids),
                SchoolMembership.role.in_(["admin", "teacher"]),
                SchoolMembership.status == "active",
            )
        ).all()
    )
    if eligible_ids != set(user_ids):
        raise HTTPException(status_code=422, detail="Selected co-teacher must belong to course school")
    return users


def _load_admission_classes(
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
    if len(classes) != len(class_ids):
        raise HTTPException(status_code=422, detail="Admission class not found")
    if any(class_group.school_id != school_id for class_group in classes):
        raise HTTPException(status_code=422, detail="Admission class must belong to course school")
    if any(class_group.kind != "homeroom" or class_group.status != "active" for class_group in classes):
        raise HTTPException(status_code=422, detail="Admission class must be an active homeroom")
    return classes


def _information_snapshot(payload: CourseDraftCreate) -> dict:
    return {
        "title": payload.title,
        "summary": payload.summary,
        "academic_year": payload.academic_year,
        "schedule_text": payload.schedule_text,
        "total_hours": payload.total_hours,
        "galaxy_key": payload.galaxy_key,
        "subject_key": payload.subject_key,
        "admission_mode": payload.admission_mode,
        "admission_class_ids": sorted(payload.admission_class_ids),
    }


def _latest_information_revision(
    db: Session,
    course_id: int,
) -> CourseInformationRevision | None:
    return db.scalar(
        select(CourseInformationRevision)
        .where(CourseInformationRevision.course_id == course_id)
        .order_by(
            CourseInformationRevision.revision_number.desc(),
            CourseInformationRevision.id.desc(),
        )
    )
