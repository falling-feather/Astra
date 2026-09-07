from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user
from app.db.session import get_db
from app.models import (
    Assignment,
    AssignmentClassPolicy,
    ClassGroup,
    Course,
    CourseClass,
    CourseCollaborator,
    CourseUnit,
    SchoolMembership,
    User,
)
from app.schemas.course import (
    AssignmentCreate,
    AssignmentRead,
    CourseClassAttach,
    CourseClassRead,
    CourseCollaboratorBatchRead,
    CourseCollaboratorBatchResult,
    CourseCollaboratorBatchUpdate,
    CourseCollaboratorCreate,
    CourseCollaboratorRead,
    CourseCollaboratorUpdate,
    CourseCreate,
    CourseOwnerTransfer,
    CourseRead,
    CourseUnitCreate,
    CourseUnitRead,
    CourseReleasePlanPatch,
    CourseReleasePlanRead,
)
from app.services.audit import record_audit_log
from app.services.assignment_policies import build_effective_assignment_policy, effective_assignment_payload
from app.services.access_control import (
    course_attached_to_class,
    get_course,
    lock_active_class_for_write,
    lock_active_school_for_write,
    lock_scope_eligible_user,
    require_class_member,
    require_class_teacher_or_admin,
    require_course_author_or_admin,
    require_course_class_assignment_scope,
    require_course_collaborator_or_admin,
    require_course_visible,
    require_school_member,
    require_school_role,
    teacher_school_ids,
    visible_class_ids,
)
from app.services.text import require_trimmed_text
from app.services.course_release_plans import (
    ensure_default_plans_for_course_class,
    ensure_default_plans_for_course_unit,
    get_course_class_or_404,
    get_plan_rows,
    plan_response_items,
    resolve_student_course_class,
    effective_unit_access,
    school_is_active,
    student_completed_unit_ids,
)


router = APIRouter()


@router.get("", response_model=list[CourseRead])
def list_courses(
    school_id: int | None = Query(default=None),
    class_id: int | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Course]:
    statement = select(Course).order_by(Course.id)
    if class_id is not None:
        class_group = require_class_member(db, current_user, class_id)
        if school_id is not None and class_group.school_id != school_id:
            raise HTTPException(status_code=422, detail="Class does not belong to requested school")
        statement = statement.join(CourseClass, CourseClass.course_id == Course.id).where(
            CourseClass.class_id == class_id,
            CourseClass.status == "active",
        )
    elif school_id is not None:
        require_school_member(db, current_user, school_id)
        statement = statement.where(Course.school_id == school_id)
        if current_user.role == "student":
            class_ids = visible_class_ids(db, current_user.id)
            if not class_ids:
                return []
            statement = statement.join(CourseClass, CourseClass.course_id == Course.id).where(
                CourseClass.class_id.in_(class_ids),
                CourseClass.status == "active",
            )
    elif current_user.role != "admin":
        school_ids = teacher_school_ids(db, current_user.id)
        if school_ids:
            statement = statement.where(Course.school_id.in_(school_ids))
            return list(db.scalars(statement).all())
        class_ids = visible_class_ids(db, current_user.id)
        if not class_ids:
            return []
        statement = statement.join(CourseClass, CourseClass.course_id == Course.id).where(
            CourseClass.class_id.in_(class_ids),
            CourseClass.status == "active",
        )
    if current_user.role == "student":
        statement = statement.where(Course.status == "published").distinct()
    return list(db.scalars(statement).all())


@router.post("", response_model=CourseRead, status_code=status.HTTP_201_CREATED)
def create_course(
    payload: CourseCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Course:
    require_school_role(db, current_user, payload.school_id, {"admin", "teacher"})
    lock_active_school_for_write(db, payload.school_id)
    current_user = lock_scope_eligible_user(
        db,
        current_user.id,
        "teacher",
        detail="Course creation requires an active teacher/admin role",
        status_code=403,
    )
    require_school_role(db, current_user, payload.school_id, {"admin", "teacher"})
    title = require_trimmed_text(payload.title, "Course title is required")
    existing = db.scalar(select(Course).where(Course.school_id == payload.school_id, Course.title == title))
    if existing is not None:
        raise HTTPException(status_code=409, detail="Course already exists in this school")
    galaxy_key = payload.galaxy_key or "englab"
    course_key = payload.course_key or f"course-{uuid4().hex}"
    existing_key = db.scalar(
        select(Course.id).where(
            Course.school_id == payload.school_id,
            Course.galaxy_key == galaxy_key,
            Course.course_key == course_key,
        )
    )
    if existing_key is not None:
        raise HTTPException(status_code=409, detail="Course key already exists in this school galaxy")

    course = Course(
        school_id=payload.school_id,
        creator_user_id=current_user.id,
        galaxy_key=galaxy_key, subject_key=payload.subject_key or payload.course_key or "general",
        course_key=course_key,
        title=title,
        summary=(payload.summary or "").strip() or None,
        status=payload.status,
    )
    db.add(course)
    db.flush()
    record_audit_log(
        db,
        actor=current_user,
        action="course.create",
        resource_type="course",
        resource_id=course.id,
        school_id=course.school_id,
        event_result="success",
        request=request,
        snapshot={
            "after": {
                "school_id": course.school_id,
                "creator_user_id": course.creator_user_id,
                "galaxy_key": course.galaxy_key, "subject_key": course.subject_key,
                "course_key": course.course_key,
                "title": course.title,
                "summary": course.summary,
                "status": course.status,
            }
        },
    )
    db.commit()
    db.refresh(course)
    return course


@router.post("/{course_id}/classes", response_model=CourseClassRead, status_code=status.HTTP_201_CREATED)
def attach_course_class(
    course_id: int,
    payload: CourseClassAttach,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CourseClass:
    course = get_course(db, course_id)
    require_school_role(db, current_user, course.school_id, {"admin", "teacher"})
    class_group = db.get(ClassGroup, payload.class_id)
    if class_group is None:
        raise HTTPException(status_code=404, detail="Class not found")
    if class_group.school_id != course.school_id:
        raise HTTPException(status_code=422, detail="Class must belong to course school")
    require_class_teacher_or_admin(
        db,
        current_user,
        class_group,
        detail="Course class attachment requires class teacher role",
    )
    class_group = lock_active_class_for_write(db, class_group.id)

    existing = db.scalar(
        select(CourseClass).where(CourseClass.course_id == course.id, CourseClass.class_id == class_group.id)
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="Course is already attached to this class")

    course_class = CourseClass(course_id=course.id, class_id=class_group.id)
    db.add(course_class)
    db.flush()
    ensure_default_plans_for_course_class(db, course_class)
    db.flush()
    record_audit_log(
        db,
        actor=current_user,
        action="course.class.attach",
        resource_type="course_class",
        resource_id=course_class.id,
        school_id=course.school_id,
        class_id=class_group.id,
        event_result="success",
        request=request,
        snapshot={
            "after": {
                "course_id": course_class.course_id,
                "class_id": course_class.class_id,
                "status": course_class.status,
                "plan_version": course_class.plan_version,
            }
        },
    )
    db.commit()
    db.refresh(course_class)
    return course_class


@router.patch("/{course_id}/owner", response_model=CourseRead)
def transfer_course_owner(
    course_id: int,
    payload: CourseOwnerTransfer,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Course:
    course = get_course(db, course_id)
    require_school_role(db, current_user, course.school_id, {"admin", "teacher"})
    require_course_author_or_admin(
        current_user,
        course,
        detail="Course owner transfer requires course owner role",
    )
    lock_active_school_for_write(db, course.school_id)
    _require_active_school_teacher(
        db,
        course.school_id,
        payload.target_user_id,
        target_not_found_detail="Course owner transfer target not found",
        membership_detail="Course owner transfer target must be active school teacher/admin",
    )
    if payload.target_user_id == course.creator_user_id:
        raise HTTPException(status_code=409, detail="Course owner is already target user")

    before = _course_snapshot(course)
    previous_owner_id = course.creator_user_id
    target_collaborator = db.scalar(
        select(CourseCollaborator).where(
            CourseCollaborator.course_id == course.id,
            CourseCollaborator.user_id == payload.target_user_id,
        )
    )
    owner_update = db.execute(
        update(Course)
        .where(Course.id == course.id, Course.creator_user_id == previous_owner_id)
        .values(creator_user_id=payload.target_user_id)
    )
    if owner_update.rowcount != 1:
        db.rollback()
        raise HTTPException(status_code=409, detail="Course owner changed; retry transfer")

    course.creator_user_id = payload.target_user_id
    collaborator_before = _course_collaborator_snapshot(target_collaborator) if target_collaborator is not None else None
    if target_collaborator is not None and target_collaborator.status != "inactive":
        target_collaborator.status = "inactive"
    collaborator_after = _course_collaborator_snapshot(target_collaborator) if target_collaborator is not None else None

    record_audit_log(
        db,
        actor=current_user,
        action="course.owner.transfer",
        resource_type="course",
        resource_id=course.id,
        school_id=course.school_id,
        event_result="success",
        request=request,
        snapshot={
            "before": before,
            "after": _course_snapshot(course),
            "target_collaborator_before": collaborator_before,
            "target_collaborator_after": collaborator_after,
        },
    )
    db.commit()
    db.refresh(course)
    return course


@router.get("/{course_id}/collaborators", response_model=list[CourseCollaboratorRead])
def list_course_collaborators(
    course_id: int,
    status_filter: str = Query(default="active", alias="status"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CourseCollaborator]:
    if status_filter not in {"active", "inactive", "all"}:
        raise HTTPException(status_code=400, detail="Invalid collaborator status")
    course = get_course(db, course_id)
    require_school_role(db, current_user, course.school_id, {"admin", "teacher"})
    require_course_collaborator_or_admin(
        db,
        current_user,
        course,
        {"editor", "content_editor", "assessment_editor", "viewer"},
        detail="Course collaborators require active collaborator role",
    )
    statement = select(CourseCollaborator).where(CourseCollaborator.course_id == course.id).order_by(
        CourseCollaborator.id
    )
    if status_filter != "all":
        statement = statement.where(CourseCollaborator.status == status_filter)
    return list(db.scalars(statement).all())


@router.post(
    "/{course_id}/collaborators",
    response_model=CourseCollaboratorRead,
    status_code=status.HTTP_201_CREATED,
)
def create_course_collaborator(
    course_id: int,
    payload: CourseCollaboratorCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CourseCollaborator:
    course = get_course(db, course_id)
    require_school_role(db, current_user, course.school_id, {"admin", "teacher"})
    require_course_author_or_admin(
        current_user,
        course,
        detail="Course collaborator management requires course owner role",
    )
    lock_active_school_for_write(db, course.school_id)
    _require_active_school_teacher(db, course.school_id, payload.user_id)
    if payload.user_id == course.creator_user_id:
        raise HTTPException(status_code=409, detail="Course creator is already an owner")
    existing = db.scalar(
        select(CourseCollaborator).where(
            CourseCollaborator.course_id == course.id,
            CourseCollaborator.user_id == payload.user_id,
        )
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="Course collaborator already exists")

    collaborator = CourseCollaborator(
        course_id=course.id,
        user_id=payload.user_id,
        role=payload.role,
        status="active",
    )
    db.add(collaborator)
    db.flush()
    record_audit_log(
        db,
        actor=current_user,
        action="course.collaborator.create",
        resource_type="course_collaborator",
        resource_id=collaborator.id,
        school_id=course.school_id,
        event_result="success",
        request=request,
        snapshot={"after": _course_collaborator_snapshot(collaborator)},
    )
    db.commit()
    db.refresh(collaborator)
    return collaborator


@router.post(
    "/{course_id}/collaborators/batch",
    response_model=CourseCollaboratorBatchRead,
)
def batch_update_course_collaborators(
    course_id: int,
    payload: CourseCollaboratorBatchUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CourseCollaboratorBatchRead:
    course = get_course(db, course_id)
    require_school_role(db, current_user, course.school_id, {"admin", "teacher"})
    require_course_author_or_admin(
        current_user,
        course,
        detail="Course collaborator management requires course owner role",
    )
    lock_active_school_for_write(db, course.school_id)

    user_ids = {item.user_id for item in payload.items}
    users = list(
        db.scalars(
            select(User)
            .where(User.id.in_(user_ids))
            .order_by(User.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).all()
    )
    active_user_ids = {user.id for user in users if user.status == "active"}
    eligible_user_ids = set(
        db.scalars(
            select(SchoolMembership.user_id)
            .join(User, User.id == SchoolMembership.user_id)
            .where(
                SchoolMembership.school_id == course.school_id,
                SchoolMembership.user_id.in_(active_user_ids),
                SchoolMembership.role.in_(["admin", "teacher"]),
                SchoolMembership.status == "active",
                User.status == "active",
                User.role.in_(["admin", "teacher"]),
            )
        ).all()
    ) if active_user_ids else set()
    existing = list(
        db.scalars(
            select(CourseCollaborator).where(
                CourseCollaborator.course_id == course.id,
                CourseCollaborator.user_id.in_(user_ids),
            )
        ).all()
    )
    collaborator_by_user_id = {collaborator.user_id: collaborator for collaborator in existing}

    seen_user_ids: set[int] = set()
    prepared_results: list[dict] = []
    audit_items: list[dict] = []
    counts = {"created": 0, "updated": 0, "unchanged": 0, "failed": 0}
    for index, item in enumerate(payload.items):
        client_ref = (item.client_ref or "").strip() or None
        collaborator = collaborator_by_user_id.get(item.user_id)
        error_code = None
        if item.user_id in seen_user_ids:
            error_code = "duplicate_item"
        elif item.user_id == course.creator_user_id:
            error_code = "course_owner_conflict"
        elif item.status == "active" and item.user_id not in eligible_user_ids:
            error_code = "collaborator_not_eligible"
        elif item.status == "inactive" and collaborator is None:
            error_code = "collaborator_not_found"
        seen_user_ids.add(item.user_id)

        if error_code is not None:
            counts["failed"] += 1
            prepared_results.append(
                {
                    "user_id": item.user_id,
                    "client_ref": client_ref,
                    "outcome": "failed",
                    "collaborator": None,
                    "error_code": error_code,
                }
            )
            audit_items.append(
                {
                    "index": index,
                    "client_ref": client_ref,
                    "user_id": item.user_id,
                    "outcome": "failed",
                    "error_code": error_code,
                }
            )
            continue

        before = _course_collaborator_snapshot(collaborator) if collaborator is not None else None
        if collaborator is None:
            collaborator = CourseCollaborator(
                course_id=course.id,
                user_id=item.user_id,
                role=item.role,
                status=item.status,
            )
            db.add(collaborator)
            collaborator_by_user_id[item.user_id] = collaborator
            outcome = "created"
        elif collaborator.role != item.role or collaborator.status != item.status:
            collaborator.role = item.role
            collaborator.status = item.status
            outcome = "updated"
        else:
            outcome = "unchanged"
        counts[outcome] += 1
        prepared_results.append(
            {
                "user_id": item.user_id,
                "client_ref": client_ref,
                "outcome": outcome,
                "collaborator": collaborator,
                "error_code": None,
            }
        )
        audit_items.append(
            {
                "index": index,
                "client_ref": client_ref,
                "user_id": item.user_id,
                "outcome": outcome,
                "before": before,
            }
        )

    db.flush()
    for audit_item, prepared in zip(audit_items, prepared_results, strict=True):
        collaborator = prepared.get("collaborator")
        if collaborator is not None:
            audit_item["after"] = _course_collaborator_snapshot(collaborator)
    record_audit_log(
        db,
        actor=current_user,
        action="course.collaborator.batch_update",
        resource_type="course_collaborator_batch",
        resource_id=course.id,
        school_id=course.school_id,
        event_result="success",
        request=request,
        snapshot={
            "items": audit_items,
            "item_count": len(payload.items),
            "created_count": counts["created"],
            "updated_count": counts["updated"],
            "unchanged_count": counts["unchanged"],
            "failed_count": counts["failed"],
            "partial_failure": 0 < counts["failed"] < len(payload.items),
        },
    )
    db.commit()

    results: list[CourseCollaboratorBatchResult] = []
    for prepared in prepared_results:
        collaborator = prepared["collaborator"]
        if collaborator is not None:
            db.refresh(collaborator)
        results.append(
            CourseCollaboratorBatchResult(
                user_id=prepared["user_id"],
                client_ref=prepared["client_ref"],
                outcome=prepared["outcome"],
                collaborator=collaborator,
                error_code=prepared["error_code"],
            )
        )
    return CourseCollaboratorBatchRead(
        items=results,
        created_count=counts["created"],
        updated_count=counts["updated"],
        unchanged_count=counts["unchanged"],
        failed_count=counts["failed"],
    )


@router.patch("/{course_id}/collaborators/{collaborator_id}", response_model=CourseCollaboratorRead)
def update_course_collaborator(
    course_id: int,
    collaborator_id: int,
    payload: CourseCollaboratorUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CourseCollaborator:
    course = get_course(db, course_id)
    require_school_role(db, current_user, course.school_id, {"admin", "teacher"})
    require_course_author_or_admin(
        current_user,
        course,
        detail="Course collaborator management requires course owner role",
    )
    collaborator = db.get(CourseCollaborator, collaborator_id)
    if collaborator is None or collaborator.course_id != course.id:
        raise HTTPException(status_code=404, detail="Course collaborator not found")
    if payload.role is None and payload.status is None:
        raise HTTPException(status_code=422, detail="Collaborator update requires role or status")
    lock_active_school_for_write(db, course.school_id)
    next_role = payload.role or collaborator.role
    next_status = payload.status or collaborator.status
    if next_status == "active":
        _require_active_school_teacher(db, course.school_id, collaborator.user_id)
    before = _course_collaborator_snapshot(collaborator)
    if collaborator.status == next_status and collaborator.role == next_role:
        return collaborator

    collaborator.role = next_role
    collaborator.status = next_status
    after = _course_collaborator_snapshot(collaborator)
    record_audit_log(
        db,
        actor=current_user,
        action="course.collaborator.update",
        resource_type="course_collaborator",
        resource_id=collaborator.id,
        school_id=course.school_id,
        event_result="success",
        request=request,
        snapshot={"before": before, "after": after},
    )
    db.commit()
    db.refresh(collaborator)
    return collaborator


@router.get("/{course_id}/units", response_model=list[CourseUnitRead])
def list_course_units(
    course_id: int,
    class_id: int | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CourseUnitRead]:
    course = require_course_visible(db, current_user, course_id)
    statement = select(CourseUnit).where(CourseUnit.course_id == course_id).order_by(CourseUnit.position)
    if current_user.role != "student":
        return [CourseUnitRead.model_validate(unit) for unit in db.scalars(statement).all()]

    class_group = resolve_student_course_class(
        db,
        student_id=current_user.id,
        course_id=course.id,
        class_id=class_id,
        detail="class_id is required for student course units when course is attached to multiple classes",
    )
    course_class = get_course_class_or_404(db, course.id, class_group.id)
    units_by_id = {unit.id: unit for unit in db.scalars(statement).all()}
    plan_rows = get_plan_rows(db, course_class)
    active_school = school_is_active(db, course.school_id)
    completed_unit_ids = student_completed_unit_ids(
        db,
        student_id=current_user.id,
        class_id=class_group.id,
        course_id=course.id,
    )
    reads: list[CourseUnitRead] = []
    for plan, unit in plan_rows:
        access = effective_unit_access(
            db,
            course=course,
            class_group=class_group,
            unit=unit,
            plan=plan,
            student_id=current_user.id,
            completed_unit_ids=completed_unit_ids,
            school_active=active_school,
        )
        if access.state == "hidden" or unit.id not in units_by_id:
            continue
        reads.append(
            CourseUnitRead(
                id=unit.id,
                course_id=unit.course_id,
                activity_key=unit.activity_key,
                title=unit.title,
                position=plan.position,
                content_slug=unit.content_slug,
                status=unit.status,
                effective_release_state=access.state,
                lock_reasons=list(access.lock_reasons),
            )
        )
    return reads


@router.post("/{course_id}/units", response_model=CourseUnitRead, status_code=status.HTTP_201_CREATED)
def create_course_unit(
    course_id: int,
    payload: CourseUnitCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CourseUnit:
    course = get_course(db, course_id)
    require_school_role(db, current_user, course.school_id, {"admin", "teacher"})
    require_course_collaborator_or_admin(
        db,
        current_user,
        course,
        {"editor", "content_editor"},
        detail="Course unit creation requires editor or content_editor role",
    )
    lock_active_school_for_write(db, course.school_id)
    content_slug = (payload.content_slug or "").strip() or None
    activity_key = payload.activity_key or f"activity-{uuid4().hex}"
    title = require_trimmed_text(payload.title, "Course unit title is required")
    existing_position = db.scalar(
        select(CourseUnit).where(CourseUnit.course_id == course_id, CourseUnit.position == payload.position)
    )
    if existing_position is not None:
        raise HTTPException(status_code=409, detail="Course unit position already exists")
    if content_slug is not None:
        existing_slug = db.scalar(
            select(CourseUnit).where(CourseUnit.course_id == course_id, CourseUnit.content_slug == content_slug)
        )
        if existing_slug is not None:
            raise HTTPException(status_code=409, detail="Course unit content slug already exists")
    existing_activity_key = db.scalar(
        select(CourseUnit.id).where(
            CourseUnit.course_id == course_id,
            CourseUnit.activity_key == activity_key,
        )
    )
    if existing_activity_key is not None:
        raise HTTPException(status_code=409, detail="Course unit activity key already exists")

    unit = CourseUnit(
        course_id=course_id,
        activity_key=activity_key,
        title=title,
        position=payload.position,
        content_slug=content_slug,
        status=payload.status,
    )
    db.add(unit)
    db.flush()
    ensure_default_plans_for_course_unit(db, unit)
    db.flush()
    record_audit_log(
        db,
        actor=current_user,
        action="course.unit.create",
        resource_type="course_unit",
        resource_id=unit.id,
        school_id=course.school_id,
        event_result="success",
        request=request,
        snapshot={
            "after": {
                "course_id": unit.course_id,
                "activity_key": unit.activity_key,
                "title": unit.title,
                "position": unit.position,
                "content_slug": unit.content_slug,
                "status": unit.status,
            }
        },
    )
    db.commit()
    db.refresh(unit)
    return unit


@router.get("/{course_id}/classes/{class_id}/release-plan", response_model=CourseReleasePlanRead)
def get_course_release_plan(
    course_id: int,
    class_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CourseReleasePlanRead:
    course = get_course(db, course_id)
    class_group = db.get(ClassGroup, class_id)
    if class_group is None:
        raise HTTPException(status_code=404, detail="Class not found")
    if class_group.school_id != course.school_id:
        raise HTTPException(status_code=422, detail="Class does not belong to course school")
    if current_user.role not in {"teacher", "admin"}:
        raise HTTPException(status_code=403, detail="Course release plan requires teacher scope")
    require_course_class_assignment_scope(
        db, current_user, course, class_group,
        detail="Course release plan requires teaching authority",
    )
    course_class = get_course_class_or_404(db, course.id, class_group.id)
    return CourseReleasePlanRead(
        course_id=course.id,
        class_id=class_group.id,
        course_class_id=course_class.id,
        plan_version=course_class.plan_version,
        items=plan_response_items(
            db,
            course=course,
            class_group=class_group,
            course_class=course_class,
            student_id=None,
        ),
    )


@router.patch("/{course_id}/classes/{class_id}/release-plan", response_model=CourseReleasePlanRead)
def patch_course_release_plan(
    course_id: int,
    class_id: int,
    payload: CourseReleasePlanPatch,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CourseReleasePlanRead:
    course = get_course(db, course_id)
    class_group = db.get(ClassGroup, class_id)
    if class_group is None:
        raise HTTPException(status_code=404, detail="Class not found")
    if class_group.school_id != course.school_id:
        raise HTTPException(status_code=422, detail="Class does not belong to course school")
    if current_user.role not in {"teacher", "admin"}:
        raise HTTPException(status_code=403, detail="Course release plan requires teacher scope")
    require_course_class_assignment_scope(
        db, current_user, course, class_group,
        detail="Course release plan requires teaching authority",
    )
    lock_active_class_for_write(db, class_group.id)
    course_class = db.scalar(
        select(CourseClass)
        .where(CourseClass.course_id == course.id, CourseClass.class_id == class_group.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if course_class is None:
        raise HTTPException(status_code=403, detail="Course is not attached to this class")
    if course_class.status != "active":
        raise HTTPException(status_code=409, detail="Course attachment is not active")
    ensure_default_plans_for_course_class(db, course_class)
    db.flush()
    if course_class.plan_version != payload.expected_version:
        raise HTTPException(status_code=409, detail="Course release plan version changed; refresh and retry")

    item_ids = [item.course_unit_id for item in payload.items]
    if len(item_ids) != len(set(item_ids)):
        raise HTTPException(status_code=422, detail="Course release plan cannot contain duplicate course_unit_id")
    plan_rows = get_plan_rows(db, course_class)
    plans_by_unit = {plan.course_unit_id: plan for plan, _ in plan_rows}
    units_by_id = {unit.id: unit for _, unit in plan_rows}
    if any(unit_id not in plans_by_unit for unit_id in item_ids):
        raise HTTPException(status_code=422, detail="Course release plan unit must belong to this course class")

    desired: dict[int, dict] = {
        plan.course_unit_id: {
            "position": plan.position,
            "release_mode": plan.release_mode,
            "open_at": plan.open_at,
            "prerequisite_unit_id": plan.prerequisite_unit_id,
        }
        for plan, _ in plan_rows
    }
    for item in payload.items:
        fields = item.model_fields_set
        target = desired[item.course_unit_id]
        for field in ("position", "release_mode", "open_at", "prerequisite_unit_id"):
            if field in fields:
                target[field] = getattr(item, field)

    positions = [item["position"] for item in desired.values()]
    if len(positions) != len(set(positions)):
        raise HTTPException(status_code=422, detail="Course release plan positions must be unique")
    for unit_id, item in desired.items():
        prerequisite_unit_id = item["prerequisite_unit_id"]
        if prerequisite_unit_id is None:
            continue
        if prerequisite_unit_id not in units_by_id:
            raise HTTPException(status_code=422, detail="Prerequisite unit must belong to this course class")
        if prerequisite_unit_id == unit_id:
            raise HTTPException(status_code=422, detail="Course unit cannot be its own prerequisite")
        if desired[prerequisite_unit_id]["position"] >= item["position"]:
            raise HTTPException(status_code=422, detail="Prerequisite unit must be earlier in the class release plan")
    _assert_plan_is_acyclic(desired)

    changed_unit_ids = [
        unit_id
        for unit_id, target in desired.items()
        if any(getattr(plans_by_unit[unit_id], field) != value for field, value in target.items())
    ]
    if changed_unit_ids:
        before = {
            str(unit_id): {
                field: getattr(plans_by_unit[unit_id], field)
                for field in ("position", "release_mode", "open_at", "prerequisite_unit_id")
            }
            for unit_id in changed_unit_ids
        }
        moved_unit_ids = [
            unit_id
            for unit_id in changed_unit_ids
            if plans_by_unit[unit_id].position != desired[unit_id]["position"]
        ]
        # The final batch is valid as a set, but relational unique constraints are
        # immediate on SQLite/MySQL. Park moved rows at unused positive positions
        # first so a swap (1 <-> 2) remains one atomic PATCH.
        temporary_base = max(positions) + len(plans_by_unit) + 1
        for index, unit_id in enumerate(moved_unit_ids):
            plans_by_unit[unit_id].position = temporary_base + index
        if moved_unit_ids:
            db.flush()
        for unit_id in changed_unit_ids:
            for field, value in desired[unit_id].items():
                setattr(plans_by_unit[unit_id], field, value)
        course_class.plan_version += 1
        db.flush()
        record_audit_log(
            db,
            actor=current_user,
            action="course.release_plan.patch",
            resource_type="course_class",
            resource_id=course_class.id,
            school_id=course.school_id,
            class_id=class_group.id,
            event_result="success",
            request=request,
            snapshot={
                "expected_version": payload.expected_version,
                "plan_version": course_class.plan_version,
                "changed_unit_ids": changed_unit_ids,
                "before": _json_safe_plan_snapshot(before),
                "after": _json_safe_plan_snapshot(
                    {str(unit_id): desired[unit_id] for unit_id in changed_unit_ids}
                ),
                "reason_provided": bool((payload.reason or "").strip()),
            },
        )
        db.commit()
    else:
        db.rollback()
        # A no-op is deliberately successful and does not consume a plan version.
        course_class = get_course_class_or_404(db, course.id, class_group.id)
    return CourseReleasePlanRead(
        course_id=course.id,
        class_id=class_group.id,
        course_class_id=course_class.id,
        plan_version=course_class.plan_version,
        changed=bool(changed_unit_ids),
        items=plan_response_items(
            db,
            course=course,
            class_group=class_group,
            course_class=course_class,
            student_id=None,
        ),
    )


@router.get("/{course_id}/assignments", response_model=list[AssignmentRead])
def list_course_assignments(
    course_id: int,
    class_id: int | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[AssignmentRead]:
    course = require_course_visible(db, current_user, course_id)
    if current_user.role == "student" and class_id is None:
        eligible_class_ids = list(
            db.scalars(
                select(CourseClass.class_id)
                .where(
                    CourseClass.course_id == course.id,
                    CourseClass.class_id.in_(visible_class_ids(db, current_user.id)),
                    CourseClass.status == "active",
                )
                .order_by(CourseClass.class_id)
            ).all()
        )
        if len(eligible_class_ids) != 1:
            raise HTTPException(status_code=422, detail="class_id is required for student assignment scope")
        class_id = eligible_class_ids[0]

    class_group = None
    if class_id is not None:
        class_group = db.get(ClassGroup, class_id)
        if class_group is None:
            raise HTTPException(status_code=404, detail="Class not found")
        if class_group.school_id != course.school_id:
            raise HTTPException(status_code=422, detail="Class does not belong to course school")
        if not course_attached_to_class(db, course.id, class_group.id):
            raise HTTPException(status_code=403, detail="Course is not attached to this class")
        require_course_class_assignment_scope(db, current_user, course, class_group)

    statement = (
        select(Assignment, AssignmentClassPolicy)
        .join(CourseUnit, CourseUnit.id == Assignment.unit_id)
        .where(CourseUnit.course_id == course_id)
        .order_by(Assignment.id)
    )
    if class_group is not None:
        statement = statement.outerjoin(
            AssignmentClassPolicy,
            and_(
                AssignmentClassPolicy.assignment_id == Assignment.id,
                AssignmentClassPolicy.class_id == class_group.id,
            ),
        ).where(
            or_(
                and_(
                    Assignment.audience_mode == "selected_classes",
                    AssignmentClassPolicy.id.is_not(None),
                    AssignmentClassPolicy.assigned.is_(True),
                ),
                and_(
                    Assignment.audience_mode == "all_attached_classes",
                    or_(AssignmentClassPolicy.id.is_(None), AssignmentClassPolicy.assigned.is_(True)),
                ),
            )
        )
        if current_user.role == "student":
            statement = statement.where(
                CourseUnit.status == "published",
                func.coalesce(AssignmentClassPolicy.status_override, Assignment.status) == "active",
            )
    else:
        statement = statement.outerjoin(
            AssignmentClassPolicy,
            and_(AssignmentClassPolicy.assignment_id == Assignment.id, AssignmentClassPolicy.id.is_(None)),
        )
    rows = db.execute(statement).all()
    reads: list[AssignmentRead] = []
    course_class = get_course_class_or_404(db, course.id, class_group.id) if class_group is not None else None
    plan_by_unit = (
        {unit.id: plan for plan, unit in get_plan_rows(db, course_class)}
        if course_class is not None
        else {}
    )
    for assignment, policy in rows:
        effective = (
            build_effective_assignment_policy(assignment, class_group.id, policy)
            if class_group is not None
            else None
        )
        payload_data = effective_assignment_payload(assignment, effective)
        if current_user.role == "student" and class_group is not None and course_class is not None:
            unit = db.get(CourseUnit, assignment.unit_id)
            if unit is None:
                continue
            plan = plan_by_unit.get(unit.id)
            if plan is None:
                continue
            access = effective_unit_access(
                db,
                course=course,
                class_group=class_group,
                unit=unit,
                plan=plan,
                student_id=current_user.id,
            )
            if access.state == "hidden":
                continue
            payload_data["unit_release_state"] = access.state
            payload_data["unit_lock_reasons"] = list(access.lock_reasons)
        reads.append(AssignmentRead.model_validate(payload_data))
    return reads


@router.post(
    "/{course_id}/units/{unit_id}/assignments",
    response_model=AssignmentRead,
    status_code=status.HTTP_201_CREATED,
)
def create_assignment(
    course_id: int,
    unit_id: int,
    payload: AssignmentCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Assignment:
    course = get_course(db, course_id)
    require_school_role(db, current_user, course.school_id, {"admin", "teacher"})
    require_course_collaborator_or_admin(
        db,
        current_user,
        course,
        {"editor", "content_editor", "assessment_editor"},
        detail="Assignment creation requires active editing collaborator role",
    )
    lock_active_school_for_write(db, course.school_id)
    unit = db.get(CourseUnit, unit_id)
    if unit is None or unit.course_id != course_id:
        raise HTTPException(status_code=404, detail="Course unit not found")
    title = require_trimmed_text(payload.title, "Assignment title is required")
    existing = db.scalar(select(Assignment).where(Assignment.unit_id == unit_id, Assignment.title == title))
    if existing is not None:
        raise HTTPException(status_code=409, detail="Assignment already exists in this unit")

    assignment = Assignment(
        unit_id=unit_id,
        title=title,
        description=(payload.description or "").strip() or None,
        due_at=payload.due_at,
        max_score=payload.max_score,
        status=payload.status,
        audience_mode=payload.audience_mode,
    )
    db.add(assignment)
    db.flush()
    record_audit_log(
        db,
        actor=current_user,
        action="assignment.create",
        resource_type="assignment",
        resource_id=assignment.id,
        school_id=course.school_id,
        event_result="success",
        request=request,
        snapshot={
            "after": {
                "course_id": course.id,
                "unit_id": assignment.unit_id,
                "title": assignment.title,
                "due_at": assignment.due_at.isoformat() if assignment.due_at is not None else None,
                "max_score": assignment.max_score,
                "status": assignment.status,
                "audience_mode": assignment.audience_mode,
            }
        },
    )
    db.commit()
    db.refresh(assignment)
    return assignment


def _require_active_school_teacher(
    db: Session,
    school_id: int,
    user_id: int,
    *,
    target_not_found_detail: str = "Course collaborator user not found",
    membership_detail: str = "Course collaborator must be active school teacher/admin",
) -> None:
    target = db.scalar(
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if target is None:
        raise HTTPException(status_code=404, detail=target_not_found_detail)
    if target.status != "active" or target.role not in {"admin", "teacher"}:
        raise HTTPException(status_code=422, detail=membership_detail)
    membership = db.scalar(
        select(SchoolMembership).where(
            SchoolMembership.school_id == school_id,
            SchoolMembership.user_id == user_id,
            SchoolMembership.role.in_(["admin", "teacher"]),
            SchoolMembership.status == "active",
        )
    )
    if membership is None:
        raise HTTPException(status_code=422, detail=membership_detail)


def _course_snapshot(course: Course) -> dict:
    return {
        "id": course.id,
        "school_id": course.school_id,
        "creator_user_id": course.creator_user_id,
        "title": course.title,
        "summary": course.summary,
        "status": course.status,
    }


def _course_collaborator_snapshot(collaborator: CourseCollaborator) -> dict:
    return {
        "id": collaborator.id,
        "course_id": collaborator.course_id,
        "user_id": collaborator.user_id,
        "role": collaborator.role,
        "status": collaborator.status,
    }


def _assert_plan_is_acyclic(desired: dict[int, dict]) -> None:
    for start in desired:
        seen: set[int] = set()
        current = start
        while desired[current]["prerequisite_unit_id"] is not None:
            prerequisite = desired[current]["prerequisite_unit_id"]
            if prerequisite in seen or prerequisite == start:
                raise HTTPException(status_code=422, detail="Course release plan prerequisites cannot contain a cycle")
            seen.add(prerequisite)
            current = prerequisite


def _json_safe_plan_snapshot(snapshot: dict[str, dict]) -> dict[str, dict]:
    safe: dict[str, dict] = {}
    for unit_id, values in snapshot.items():
        safe[str(unit_id)] = {
            field: (
                value.replace(tzinfo=UTC).isoformat()
                if isinstance(value, datetime) and value.tzinfo is None
                else value.astimezone(UTC).isoformat()
                if isinstance(value, datetime)
                else value
            )
            for field, value in values.items()
        }
    return safe
