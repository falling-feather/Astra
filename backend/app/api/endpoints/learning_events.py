from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user
from app.db.session import get_db
from app.models import (
    Assignment,
    AssignmentClassPolicy,
    ClassGroup,
    Course,
    CourseClass,
    CourseUnit,
    CourseUnitClassPlan,
    LearningEvent,
    School,
    User,
)
from app.models.base import utc_now
from app.schemas.course import LearningEventCreate, LearningEventPage, LearningEventRead
from app.services.access_control import (
    course_attached_to_class,
    get_class,
    lock_active_class_for_write,
    lock_active_school_for_write,
    require_class_member,
    require_class_teacher_or_admin,
    require_course_visible,
    require_student_unit_published,
    teacher_class_ids,
)
from app.services.assignment_policies import resolve_assignment_class_policy
from app.services.course_release_write_gate import (
    require_student_unit_open_for_write,
)
from app.services.legacy_learning_events import (
    reject_retired_complete_write,
    resolve_learning_scope,
)
from app.services.pagination import list_legacy_scalars, paged_endpoint_url


router = APIRouter()


@router.post("", response_model=LearningEventRead, status_code=status.HTTP_201_CREATED)
def create_learning_event(
    payload: LearningEventCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LearningEvent:
    reject_retired_complete_write(payload.event_type)
    if payload.assignment_id is not None and payload.class_id is None:
        raise HTTPException(status_code=422, detail="Assignment learning events require class_id")
    if current_user.role == "student" and payload.class_id is None:
        raise HTTPException(status_code=422, detail="Student learning events require class_id")
    course, unit, assignment = resolve_learning_scope(db, payload)
    if course is None:
        raise HTTPException(status_code=422, detail="Learning event must target a course, unit, or assignment")
    require_course_visible(db, current_user, course.id)
    if unit is not None:
        require_student_unit_published(current_user, unit)

    class_group: ClassGroup | None = None
    if payload.class_id is not None:
        class_group = require_class_member(db, current_user, payload.class_id)
        if class_group.school_id != course.school_id:
            raise HTTPException(status_code=422, detail="Class does not belong to course school")
        if not course_attached_to_class(db, course.id, class_group.id):
            raise HTTPException(status_code=403, detail="Course is not attached to this class")
    if unit is not None and current_user.role == "student" and class_group is not None:
        class_group = require_student_unit_open_for_write(
            db,
            course=course,
            class_group=class_group,
            unit=unit,
            student_id=current_user.id,
        )
    if assignment is not None and class_group is not None:
        effective = resolve_assignment_class_policy(
            db,
            assignment,
            class_group.id,
            locking_read=current_user.role == "student",
        )
        if not effective.assigned:
            raise HTTPException(status_code=403, detail="Assignment is not assigned to this class")
        if current_user.role == "student" and effective.status != "active":
            raise HTTPException(status_code=409, detail="Assignment is not active")
    if class_group is not None:
        if not (unit is not None and current_user.role == "student"):
            class_group = lock_active_class_for_write(db, class_group.id)
    else:
        lock_active_school_for_write(db, course.school_id)

    event = LearningEvent(
        user_id=current_user.id,
        school_id=course.school_id,
        class_id=class_group.id if class_group is not None else None,
        course_id=course.id,
        unit_id=unit.id if unit is not None else None,
        assignment_id=assignment.id if assignment is not None else None,
        knowledge_code=(payload.knowledge_code or "").strip().lower() or None,
        event_type=payload.event_type,
        payload=payload.payload,
        occurred_at=payload.occurred_at or utc_now(),
    )
    db.add(event)
    db.flush([event])
    db.commit()
    db.refresh(event)
    return event
@router.get("", response_model=list[LearningEventRead], deprecated=True)
def list_learning_events(
    class_id: int | None = Query(default=None),
    user_id: int | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[LearningEvent]:
    statement = _learning_event_page_statement(
        db,
        current_user=current_user,
        class_id=class_id,
        user_id=user_id,
        include_inactive_locked=current_user.role == "student",
    )
    return list_legacy_scalars(
        db,
        statement,
        paged_endpoint=paged_endpoint_url(
            "/api/learning-events/page",
            class_id=class_id,
            user_id=user_id,
            include_inactive_locked="true" if current_user.role == "student" else None,
            limit=200,
            offset=0,
        ),
    )


@router.get("/page", response_model=LearningEventPage)
def list_learning_events_page(
    class_id: int | None = Query(default=None),
    user_id: int | None = Query(default=None),
    include_inactive_locked: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LearningEventPage:
    statement = _learning_event_page_statement(
        db,
        current_user=current_user,
        class_id=class_id,
        user_id=user_id,
        include_inactive_locked=include_inactive_locked,
    )
    total = int(db.scalar(select(func.count()).select_from(statement.order_by(None).subquery())) or 0)
    items = list(db.scalars(statement.offset(offset).limit(limit)).all())
    next_offset = offset + len(items)
    return LearningEventPage(
        items=[LearningEventRead.model_validate(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
        next_offset=next_offset if next_offset < total else None,
    )


def _learning_event_page_statement(
    db: Session,
    *,
    current_user: User,
    class_id: int | None,
    user_id: int | None,
    include_inactive_locked: bool = False,
):
    statement = select(LearningEvent).order_by(LearningEvent.id)
    if current_user.role == "admin":
        if class_id is not None:
            statement = statement.where(LearningEvent.class_id == class_id)
        if user_id is not None:
            statement = statement.where(LearningEvent.user_id == user_id)
        return statement
    if current_user.role == "student":
        if user_id is not None and user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Students can only view their own learning events")
        statement = statement.where(LearningEvent.user_id == current_user.id)
        if class_id is not None:
            require_class_member(db, current_user, class_id)
            statement = statement.where(LearningEvent.class_id == class_id)
        statement = _apply_student_visible_event_filters(statement)
        if include_inactive_locked:
            return _apply_student_legacy_release_filters(statement)
        return _apply_student_database_release_filters(statement)
    if class_id is not None:
        class_group = get_class(db, class_id)
        require_class_teacher_or_admin(
            db,
            current_user,
            class_group,
            detail="Learning events require class teacher scope",
        )
        statement = statement.where(LearningEvent.class_id == class_id)
        if user_id is not None:
            statement = statement.where(LearningEvent.user_id == user_id)
        return statement
    class_ids = teacher_class_ids(db, current_user.id)
    if not class_ids:
        return statement.where(LearningEvent.id.is_(None))
    statement = statement.where(LearningEvent.class_id.in_(class_ids))
    if user_id is not None:
        statement = statement.where(LearningEvent.user_id == user_id)
    return statement


def _apply_student_database_release_filters(statement):
    return (
        statement.outerjoin(
            ClassGroup,
            ClassGroup.id == LearningEvent.class_id,
        )
        .outerjoin(
            School,
            School.id == Course.school_id,
        )
        .outerjoin(
            CourseClass,
            and_(
                CourseClass.course_id == LearningEvent.course_id,
                CourseClass.class_id == LearningEvent.class_id,
            ),
        )
        .outerjoin(
            CourseUnitClassPlan,
            and_(
                CourseUnitClassPlan.course_class_id == CourseClass.id,
                CourseUnitClassPlan.course_unit_id == LearningEvent.unit_id,
            ),
        )
        .where(
            or_(
                LearningEvent.unit_id.is_(None),
                and_(
                    School.status == "active",
                    ClassGroup.status == "active",
                    CourseClass.id.is_not(None),
                    CourseClass.status == "active",
                    CourseUnitClassPlan.id.is_not(None),
                    CourseUnitClassPlan.release_mode != "hidden",
                ),
            )
        )
    )


def _apply_student_visible_event_filters(statement):
    effective_assignment_status = func.coalesce(AssignmentClassPolicy.status_override, Assignment.status)
    assignment_is_visible = or_(
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
    return (
        statement.outerjoin(Course, Course.id == LearningEvent.course_id)
        .outerjoin(CourseUnit, CourseUnit.id == LearningEvent.unit_id)
        .outerjoin(Assignment, Assignment.id == LearningEvent.assignment_id)
        .outerjoin(
            AssignmentClassPolicy,
            and_(
                AssignmentClassPolicy.assignment_id == LearningEvent.assignment_id,
                AssignmentClassPolicy.class_id == LearningEvent.class_id,
            ),
        )
        .where(
            or_(LearningEvent.course_id.is_(None), Course.status == "published"),
            or_(LearningEvent.unit_id.is_(None), CourseUnit.status == "published"),
            or_(
                LearningEvent.assignment_id.is_(None),
                and_(assignment_is_visible, effective_assignment_status == "active"),
            ),
        )
    )


def _apply_student_legacy_release_filters(statement):
    """Preserve the deprecated array endpoint's historical locked-record view.

    The legacy endpoint treated inactive schools, classes, and course-class
    attachments as locked rather than hidden. Missing or explicitly hidden
    release plans remained invisible. This SQL predicate retains that contract
    without materializing the full result set in Python.
    """
    return (
        statement.outerjoin(
            ClassGroup,
            ClassGroup.id == LearningEvent.class_id,
        )
        .outerjoin(
            CourseClass,
            and_(
                CourseClass.course_id == LearningEvent.course_id,
                CourseClass.class_id == LearningEvent.class_id,
            ),
        )
        .outerjoin(
            CourseUnitClassPlan,
            and_(
                CourseUnitClassPlan.course_class_id == CourseClass.id,
                CourseUnitClassPlan.course_unit_id == LearningEvent.unit_id,
            ),
        )
        .where(
            or_(
                LearningEvent.unit_id.is_(None),
                and_(
                    ClassGroup.id.is_not(None),
                    CourseClass.id.is_not(None),
                    CourseUnitClassPlan.id.is_not(None),
                    CourseUnitClassPlan.release_mode != "hidden",
                ),
            )
        )
    )
