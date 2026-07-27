"""Class-scoped course release plans and the single effective-access decision path."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models import (
    Assignment,
    ClassGroup,
    ClassMembership,
    Course,
    CourseClass,
    CourseUnit,
    CourseUnitClassPlan,
    LearningEvent,
    School,
    Submission,
    User,
)
from app.models.base import utc_now
from app.services.learning_evidence_access import (
    authoritative_activity_projections_by_subjects,
    authoritative_prerequisite_unit_ids,
    prerequisite_access_unit_ids_by_subjects,
)


RELEASE_MODES = {"hidden", "locked", "open"}
PLAN_PATCH_MAX_ITEMS = 100


@dataclass(frozen=True)
class EffectiveUnitAccess:
    state: str
    lock_reasons: tuple[str, ...] = ()


def ensure_default_plans_for_course_class(db: Session, course_class: CourseClass) -> None:
    """Create only absent legacy/default rows; callers own the transaction."""
    existing_unit_ids = set(
        db.scalars(
            select(CourseUnitClassPlan.course_unit_id).where(
                CourseUnitClassPlan.course_class_id == course_class.id
            )
        ).all()
    )
    units = list(
        db.scalars(
            select(CourseUnit)
            .where(CourseUnit.course_id == course_class.course_id)
            .order_by(CourseUnit.position, CourseUnit.id)
        ).all()
    )
    for unit in units:
        if unit.id not in existing_unit_ids:
            db.add(
                CourseUnitClassPlan(
                    course_class_id=course_class.id,
                    course_unit_id=unit.id,
                    position=unit.position,
                    release_mode="open",
                )
            )


def ensure_default_plans_for_course_unit(db: Session, unit: CourseUnit) -> None:
    course_classes = list(
        db.scalars(
            select(CourseClass).where(CourseClass.course_id == unit.course_id)
        ).all()
    )
    for course_class in course_classes:
        existing = db.scalar(
            select(CourseUnitClassPlan.id).where(
                CourseUnitClassPlan.course_class_id == course_class.id,
                CourseUnitClassPlan.course_unit_id == unit.id,
            )
        )
        if existing is None:
            db.add(
                CourseUnitClassPlan(
                    course_class_id=course_class.id,
                    course_unit_id=unit.id,
                    position=unit.position,
                    release_mode="open",
                )
            )


def get_course_class_or_404(db: Session, course_id: int, class_id: int) -> CourseClass:
    course_class = db.scalar(
        select(CourseClass).where(
            CourseClass.course_id == course_id,
            CourseClass.class_id == class_id,
        )
    )
    if course_class is None:
        raise HTTPException(status_code=403, detail="Course is not attached to this class")
    return course_class


def get_plan_rows(db: Session, course_class: CourseClass) -> list[tuple[CourseUnitClassPlan, CourseUnit]]:
    rows = list(
        db.execute(
            select(CourseUnitClassPlan, CourseUnit)
            .join(CourseUnit, CourseUnit.id == CourseUnitClassPlan.course_unit_id)
            .where(CourseUnitClassPlan.course_class_id == course_class.id)
            .order_by(CourseUnitClassPlan.position, CourseUnit.id)
        ).all()
    )
    expected = int(
        db.scalar(select(func.count()).select_from(CourseUnit).where(CourseUnit.course_id == course_class.course_id))
        or 0
    )
    if len(rows) != expected:
        raise HTTPException(status_code=409, detail="Course release plan is inconsistent")
    return rows


def get_plan_for_unit(
    db: Session,
    course_class: CourseClass,
    unit_id: int,
) -> CourseUnitClassPlan:
    plan = db.scalar(
        select(CourseUnitClassPlan).where(
            CourseUnitClassPlan.course_class_id == course_class.id,
            CourseUnitClassPlan.course_unit_id == unit_id,
        )
    )
    if plan is None:
        raise HTTPException(status_code=409, detail="Course release plan is inconsistent")
    return plan


def effective_unit_access(
    db: Session,
    *,
    course: Course,
    class_group: ClassGroup,
    unit: CourseUnit,
    plan: CourseUnitClassPlan,
    student_id: int | None,
    now: datetime | None = None,
    completed_unit_ids: set[int] | None = None,
    school_active: bool | None = None,
) -> EffectiveUnitAccess:
    """Return the authoritative presentation/action state for one class-unit pair."""
    if plan.release_mode == "hidden":
        return EffectiveUnitAccess("hidden")
    if course.status != "published" or unit.status != "published":
        return EffectiveUnitAccess("hidden")
    if class_group.status != "active":
        return EffectiveUnitAccess("locked", ("organization_inactive",))
    if school_active is None:
        school_active = db.scalar(select(School.status).where(School.id == course.school_id)) == "active"
    if not school_active:
        return EffectiveUnitAccess("locked", ("organization_inactive",))
    if plan.release_mode == "locked":
        return EffectiveUnitAccess("locked", ("manual_locked",))
    current = now or utc_now()
    if plan.open_at is not None and _as_utc(plan.open_at) > _as_utc(current):
        return EffectiveUnitAccess("locked", ("scheduled",))
    if plan.prerequisite_unit_id is not None:
        if student_id is None:
            return EffectiveUnitAccess("locked", ("prerequisite",))
        if completed_unit_ids is None:
            completed_unit_ids = authoritative_prerequisite_unit_ids(
                db,
                subject_user_id=student_id,
                class_id=class_group.id,
                course_id=course.id,
            )
        if plan.prerequisite_unit_id not in completed_unit_ids:
            return EffectiveUnitAccess("locked", ("prerequisite",))
    return EffectiveUnitAccess("open")


def require_student_unit_open(
    db: Session,
    *,
    course: Course,
    class_group: ClassGroup,
    unit: CourseUnit,
    student_id: int,
) -> EffectiveUnitAccess:
    course_class = get_course_class_or_404(db, course.id, class_group.id)
    plan = get_plan_for_unit(db, course_class, unit.id)
    access = effective_unit_access(
        db,
        course=course,
        class_group=class_group,
        unit=unit,
        plan=plan,
        student_id=student_id,
    )
    if access.state == "hidden":
        raise HTTPException(status_code=403, detail="Course unit is not visible in this class")
    if access.state != "open":
        raise HTTPException(status_code=409, detail="Course unit is locked in this class")
    return access


def school_is_active(db: Session, school_id: int) -> bool:
    return db.scalar(select(School.status).where(School.id == school_id)) == "active"


def student_completed_unit_ids(
    db: Session,
    *,
    student_id: int,
    class_id: int,
    course_id: int,
) -> set[int]:
    return authoritative_prerequisite_unit_ids(
        db,
        subject_user_id=student_id,
        class_id=class_id,
        course_id=course_id,
    )


def student_visible_course_class_ids(db: Session, student_id: int, course_id: int) -> list[int]:
    return list(
        db.scalars(
            select(CourseClass.class_id)
            .join(ClassMembership, ClassMembership.class_id == CourseClass.class_id)
            .join(ClassGroup, ClassGroup.id == CourseClass.class_id)
            .join(School, School.id == ClassGroup.school_id)
            .where(
                CourseClass.course_id == course_id,
                CourseClass.status == "active",
                ClassMembership.user_id == student_id,
                ClassMembership.role == "student",
                ClassMembership.status == "active",
                ClassGroup.status == "active",
                School.status == "active",
            )
            .distinct()
            .order_by(CourseClass.class_id)
        ).all()
    )


def resolve_student_course_class(
    db: Session,
    *,
    student_id: int,
    course_id: int,
    class_id: int | None,
    detail: str,
) -> ClassGroup:
    eligible_ids = student_visible_course_class_ids(db, student_id, course_id)
    if class_id is None:
        if len(eligible_ids) != 1:
            raise HTTPException(status_code=422, detail=detail)
        class_id = eligible_ids[0]
    if class_id not in eligible_ids:
        raise HTTPException(status_code=403, detail="Class is outside current student course scope")
    class_group = db.get(ClassGroup, class_id)
    if class_group is None:
        raise HTTPException(status_code=404, detail="Class not found")
    return class_group


def plan_response_items(
    db: Session,
    *,
    course: Course,
    class_group: ClassGroup,
    course_class: CourseClass,
    student_id: int | None,
) -> list[dict]:
    items: list[dict] = []
    plan_rows = get_plan_rows(db, course_class)
    active_school = school_is_active(db, course.school_id)
    completed_unit_ids = (
        student_completed_unit_ids(
            db,
            student_id=student_id,
            class_id=class_group.id,
            course_id=course.id,
        )
        if student_id is not None
        else None
    )
    for plan, unit in plan_rows:
        access = effective_unit_access(
            db,
            course=course,
            class_group=class_group,
            unit=unit,
            plan=plan,
            student_id=student_id,
            completed_unit_ids=completed_unit_ids,
            school_active=active_school,
        )
        if student_id is not None and access.state == "hidden":
            continue
        items.append(
            {
            "id": plan.id,
            "course_unit_id": unit.id,
            "activity_key": unit.activity_key,
            "position": plan.position,
            "release_mode": plan.release_mode,
            "open_at": plan.open_at,
            "prerequisite_unit_id": plan.prerequisite_unit_id,
            "effective_release_state": access.state,
            "lock_reasons": list(access.lock_reasons),
            }
        )
    return items


def build_student_course_progress_page(
    db: Session,
    *,
    course: Course,
    class_group: ClassGroup,
    course_class: CourseClass,
    limit: int,
    offset: int,
) -> dict:
    school = db.get(School, class_group.school_id)
    if class_group.status != "active" or school is None or school.status != "active":
        return {
            "course_id": course.id,
            "class_id": class_group.id,
            "plan_version": course_class.plan_version,
            "items": [],
            "total": 0,
            "limit": limit,
            "offset": offset,
            "next_offset": None,
        }
    student_statement = (
        select(User)
        .join(ClassMembership, ClassMembership.user_id == User.id)
        .where(
            ClassMembership.class_id == class_group.id,
            ClassMembership.role == "student",
            ClassMembership.status == "active",
            User.role == "student",
            User.status == "active",
        )
        .order_by(User.id)
    )
    total = int(db.scalar(select(func.count()).select_from(student_statement.order_by(None).subquery())) or 0)
    page_students = list(db.scalars(student_statement.offset(offset).limit(limit)).all())
    plan_rows = get_plan_rows(db, course_class)
    unit_ids = [unit.id for _, unit in plan_rows]
    student_ids = [student.id for student in page_students]
    event_stats: dict[tuple[int, int], dict] = {}
    submission_stats: dict[tuple[int, int], dict] = {}
    projections = authoritative_activity_projections_by_subjects(
        db,
        subject_user_ids=student_ids,
        class_id=class_group.id,
        course_id=course.id,
    )
    completed_by_student: dict[int, set[int]] = {
        student_id: set() for student_id in student_ids
    }
    for (student_id, unit_id), projection in projections.items():
        if projection.status in {"completed", "transferred"}:
            completed_by_student[student_id].add(unit_id)
    access_by_student = prerequisite_access_unit_ids_by_subjects(
        db,
        subject_user_ids=student_ids,
        class_id=class_group.id,
        course_id=course.id,
    )
    if student_ids and unit_ids:
        event_rows = db.execute(
            select(
                LearningEvent.user_id,
                LearningEvent.unit_id,
                func.max(
                    case((LearningEvent.event_type.in_(["visit", "start", "submit", "complete"]), 1), else_=0)
                ).label("started"),
                func.max(LearningEvent.occurred_at).label("recent_activity_at"),
            )
            .where(
                LearningEvent.user_id.in_(student_ids),
                LearningEvent.class_id == class_group.id,
                LearningEvent.course_id == course.id,
                LearningEvent.unit_id.in_(unit_ids),
            )
            .group_by(LearningEvent.user_id, LearningEvent.unit_id)
        ).mappings()
        for row in event_rows:
            key = (int(row["user_id"]), int(row["unit_id"]))
            event_stats[key] = dict(row)
        submission_rows = db.execute(
            select(
                Submission.student_id,
                Assignment.unit_id,
                func.count(Submission.id).label("submitted"),
                func.coalesce(
                    func.sum(case((Submission.status.in_(["graded", "returned"]), 1), else_=0)),
                    0,
                ).label("graded"),
                func.max(Submission.submitted_at).label("recent_submission_at"),
            )
            .join(Assignment, Assignment.id == Submission.assignment_id)
            .where(
                Submission.student_id.in_(student_ids),
                Submission.class_id == class_group.id,
                Assignment.unit_id.in_(unit_ids),
            )
            .group_by(Submission.student_id, Assignment.unit_id)
        ).mappings()
        for row in submission_rows:
            submission_stats[(int(row["student_id"]), int(row["unit_id"]))] = dict(row)
    items: list[dict] = []
    for student in page_students:
        blocks: list[dict] = []
        for plan, unit in plan_rows:
            access = effective_unit_access(
                db,
                course=course,
                class_group=class_group,
                unit=unit,
                plan=plan,
                student_id=student.id,
                completed_unit_ids=access_by_student[student.id],
                school_active=True,
            )
            row = {
                "course_unit_id": unit.id,
                "activity_key": unit.activity_key,
                "position": plan.position,
                "started": False,
                "completed": False,
                "submitted": 0,
                "graded": 0,
                "recent_activity_at": None,
                "effective_release_state": access.state,
            }
            if access.state != "hidden":
                event_stat = event_stats.get((student.id, unit.id), {})
                submission_stat = submission_stats.get((student.id, unit.id), {})
                projection = projections.get((student.id, unit.id))
                timestamps = [
                    timestamp
                    for timestamp in (
                        event_stat.get("recent_activity_at"),
                        submission_stat.get("recent_submission_at"),
                        (
                            projection.last_occurred_at
                            if projection is not None
                            else None
                        ),
                    )
                    if timestamp is not None
                ]
                row.update(
                    started=(
                        bool(event_stat.get("started"))
                        or bool(submission_stat.get("submitted"))
                        or (
                            projection is not None
                            and projection.status != "not_started"
                        )
                    ),
                    completed=unit.id in completed_by_student[student.id],
                    submitted=int(submission_stat.get("submitted") or 0),
                    graded=int(submission_stat.get("graded") or 0),
                    recent_activity_at=max(timestamps) if timestamps else None,
                )
            blocks.append(row)
        items.append({"student_id": student.id, "display_name": student.display_name or student.username, "blocks": blocks})
    next_offset = offset + len(items)
    return {
        "course_id": course.id,
        "class_id": class_group.id,
        "plan_version": course_class.plan_version,
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
        "next_offset": next_offset if next_offset < total else None,
    }


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
