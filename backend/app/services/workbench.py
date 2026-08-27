from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from fastapi import HTTPException
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session

from app.models import (
    Assignment,
    AssignmentClassPolicy,
    ClassGroup,
    ClassMembership,
    Course,
    CourseClass,
    CourseCollaborator,
    CourseEnrollment,
    CourseInformationRevision,
    CourseJoinRequest,
    CourseRelease,
    CourseReleaseUnit,
    CourseUnit,
    CourseUnitClassPlan,
    LearningActivityProjection,
    LearningResumeProjection,
    School,
    SchoolMembership,
    Submission,
    TeacherApplication,
    User,
)
from app.models.base import utc_now

logger = logging.getLogger(__name__)


def build_workbench(
    db: Session,
    *,
    actor: User,
    limit: int,
    offset: int,
) -> dict[str, Any]:
    if actor.role == "student":
        return _build_student_workbench(db, actor=actor, limit=limit, offset=offset)
    if actor.role == "teacher":
        return _build_teacher_workbench(db, actor=actor, limit=limit, offset=offset)
    if actor.role == "admin":
        return _build_admin_workbench(db, limit=limit, offset=offset)
    raise HTTPException(status_code=403, detail="Workbench role is not supported")


def _build_student_workbench(
    db: Session,
    *,
    actor: User,
    limit: int,
    offset: int,
) -> dict[str, Any]:
    issues: list[dict[str, str]] = []
    courses = _safe_section(
        db,
        issues=issues,
        section="courses",
        loader=lambda: _student_courses(db, actor.id, limit, offset),
        fallback=lambda: _empty_page(limit, offset),
    )
    assignments = _safe_section(
        db,
        issues=issues,
        section="assignments",
        loader=lambda: _student_assignments(db, actor.id, limit, offset),
        fallback=lambda: _empty_page(limit, offset),
    )
    continue_learning = _safe_section(
        db,
        issues=issues,
        section="continue_learning",
        loader=lambda: _student_continue_learning(db, actor.id),
        fallback=lambda: None,
    )
    submissions = _safe_section(
        db,
        issues=issues,
        section="submissions",
        loader=lambda: _student_submission_summary(db, actor.id),
        fallback=lambda: {"submitted": 0, "graded": 0, "returned": 0},
    )
    homerooms = _safe_section(
        db,
        issues=issues,
        section="homerooms",
        loader=lambda: _student_homerooms(db, actor.id, limit, offset),
        fallback=lambda: _empty_page(limit, offset),
    )
    return {
        "role": "student",
        "generated_at": utc_now(),
        "primary_action": _student_primary_action(
            courses=courses,
            assignments=assignments,
            continue_learning=continue_learning,
        ),
        "courses": courses,
        "assignments": assignments,
        "continue_learning": continue_learning,
        "submissions": submissions,
        "homerooms": homerooms,
        "section_errors": issues,
    }


def _build_teacher_workbench(
    db: Session,
    *,
    actor: User,
    limit: int,
    offset: int,
) -> dict[str, Any]:
    issues: list[dict[str, str]] = []
    courses = _safe_section(
        db,
        issues=issues,
        section="courses",
        loader=lambda: _teacher_courses(db, actor.id, limit, offset),
        fallback=lambda: _empty_page(limit, offset),
    )
    pending_students = _safe_section(
        db,
        issues=issues,
        section="pending_students",
        loader=lambda: _teacher_pending_students(db, actor.id, limit, offset),
        fallback=lambda: _empty_page(limit, offset),
    )
    unpublished_drafts = _safe_section(
        db,
        issues=issues,
        section="unpublished_drafts",
        loader=lambda: _teacher_unpublished_drafts(db, actor.id, limit, offset),
        fallback=lambda: _empty_page(limit, offset),
    )
    pending_grading = _safe_section(
        db,
        issues=issues,
        section="pending_grading",
        loader=lambda: _teacher_pending_grading(db, actor.id, limit, offset),
        fallback=lambda: _empty_page(limit, offset),
    )
    return {
        "role": "teacher",
        "generated_at": utc_now(),
        "primary_action": _teacher_primary_action(
            courses=courses,
            pending_students=pending_students,
            unpublished_drafts=unpublished_drafts,
            pending_grading=pending_grading,
        ),
        "courses": courses,
        "pending_students": pending_students,
        "unpublished_drafts": unpublished_drafts,
        "pending_grading": pending_grading,
        "section_errors": issues,
    }


def _build_admin_workbench(
    db: Session,
    *,
    limit: int,
    offset: int,
) -> dict[str, Any]:
    issues: list[dict[str, str]] = []
    applications = _safe_section(
        db,
        issues=issues,
        section="pending_teacher_applications",
        loader=lambda: _admin_pending_teacher_applications(db, limit, offset),
        fallback=lambda: _empty_page(limit, offset),
    )
    revisions = _safe_section(
        db,
        issues=issues,
        section="pending_course_revisions",
        loader=lambda: _admin_pending_course_revisions(db, limit, offset),
        fallback=lambda: _empty_page(limit, offset),
    )
    alerts = _safe_section(
        db,
        issues=issues,
        section="organization_alerts",
        loader=lambda: _admin_organization_alerts(db, limit, offset),
        fallback=lambda: _empty_page(limit, offset),
    )
    totals = _safe_section(
        db,
        issues=issues,
        section="catalog_totals",
        loader=lambda: _admin_catalog_totals(db),
        fallback=lambda: {
            "users": 0,
            "courses": 0,
            "active_schools": 0,
            "active_homerooms": 0,
        },
    )
    teaching_snapshot = _safe_section(
        db,
        issues=issues,
        section="teaching_snapshot",
        loader=lambda: _admin_teaching_snapshot(db),
        fallback=lambda: _empty_admin_teaching_snapshot(),
    )
    return {
        "role": "admin",
        "generated_at": utc_now(),
        "primary_action": _admin_primary_action(
            applications=applications,
            revisions=revisions,
            alerts=alerts,
        ),
        "pending_teacher_applications": applications,
        "pending_course_revisions": revisions,
        "organization_alerts": alerts,
        "catalog_totals": totals,
        "teaching_snapshot": teaching_snapshot,
        "section_errors": issues,
    }


def _student_courses(db: Session, student_id: int, limit: int, offset: int) -> dict:
    release_id = (
        select(CourseRelease.id)
        .where(CourseRelease.course_id == Course.id)
        .order_by(CourseRelease.release_number.desc(), CourseRelease.id.desc())
        .limit(1)
        .correlate(Course)
        .scalar_subquery()
    )
    release_number = (
        select(CourseRelease.release_number)
        .where(CourseRelease.id == release_id)
        .scalar_subquery()
    )
    unit_count = (
        select(func.count(CourseReleaseUnit.id))
        .where(CourseReleaseUnit.course_release_id == release_id)
        .scalar_subquery()
    )
    completed_count = (
        select(func.count(func.distinct(LearningActivityProjection.course_unit_id)))
        .where(
            LearningActivityProjection.subject_user_id == student_id,
            LearningActivityProjection.course_id == Course.id,
            LearningActivityProjection.status.in_(["completed", "transferred"]),
        )
        .correlate(Course)
        .scalar_subquery()
    )
    base = (
        select(
            Course,
            release_id.label("release_id"),
            release_number.label("release_number"),
            unit_count.label("unit_count"),
            completed_count.label("completed_count"),
        )
        .join(CourseEnrollment, CourseEnrollment.course_id == Course.id)
        .where(
            CourseEnrollment.student_id == student_id,
            CourseEnrollment.status == "active",
            Course.status == "published",
        )
    )
    total = _statement_total(db, base)
    rows = db.execute(
        base.order_by(CourseEnrollment.updated_at.desc(), CourseEnrollment.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    items = [
        {
            "course_id": course.id,
            "title": course.title,
            "course_code": course.course_code,
            "galaxy_key": course.galaxy_key,
            "subject_key": course.subject_key,
            "schedule_text": course.schedule_text,
            "current_release_id": current_release_id,
            "current_release_number": current_release_number,
            "published_unit_count": int(published_units or 0),
            "completed_unit_count": int(completed_units or 0),
        }
        for course, current_release_id, current_release_number, published_units, completed_units in rows
    ]
    return _page(items, total, limit, offset)


def _student_assignments(db: Session, student_id: int, limit: int, offset: int) -> dict:
    effective_status = func.coalesce(
        AssignmentClassPolicy.status_override, Assignment.status
    )
    effective_due_at = case(
        (
            AssignmentClassPolicy.due_at_overridden.is_(True),
            AssignmentClassPolicy.due_at_override,
        ),
        else_=Assignment.due_at,
    )
    base = (
        select(
            Assignment,
            Course,
            CourseUnit,
            Submission,
            effective_due_at.label("effective_due_at"),
        )
        .select_from(CourseEnrollment)
        .join(Course, Course.id == CourseEnrollment.course_id)
        .join(CourseClass, CourseClass.course_id == Course.id)
        .join(
            ClassGroup,
            and_(
                ClassGroup.id == CourseClass.class_id,
                ClassGroup.kind == "course_cohort",
            ),
        )
        .join(
            ClassMembership,
            and_(
                ClassMembership.class_id == ClassGroup.id,
                ClassMembership.user_id == student_id,
                ClassMembership.role == "student",
                ClassMembership.status == "active",
            ),
        )
        .join(CourseUnit, CourseUnit.course_id == Course.id)
        .join(
            CourseUnitClassPlan,
            and_(
                CourseUnitClassPlan.course_class_id == CourseClass.id,
                CourseUnitClassPlan.course_unit_id == CourseUnit.id,
                CourseUnitClassPlan.release_mode != "hidden",
            ),
        )
        .join(Assignment, Assignment.unit_id == CourseUnit.id)
        .outerjoin(
            AssignmentClassPolicy,
            and_(
                AssignmentClassPolicy.assignment_id == Assignment.id,
                AssignmentClassPolicy.class_id == ClassGroup.id,
            ),
        )
        .outerjoin(
            Submission,
            and_(
                Submission.assignment_id == Assignment.id,
                Submission.student_id == student_id,
                Submission.class_id == ClassGroup.id,
            ),
        )
        .where(
            CourseEnrollment.student_id == student_id,
            CourseEnrollment.status == "active",
            Course.status == "published",
            CourseClass.status == "active",
            ClassGroup.status == "active",
            CourseUnit.status == "published",
            effective_status == "active",
            or_(
                and_(
                    Assignment.audience_mode == "selected_classes",
                    AssignmentClassPolicy.id.is_not(None),
                    AssignmentClassPolicy.assigned.is_(True),
                ),
                and_(
                    Assignment.audience_mode == "all_attached_classes",
                    or_(
                        AssignmentClassPolicy.id.is_(None),
                        AssignmentClassPolicy.assigned.is_(True),
                    ),
                ),
            ),
        )
    )
    total = _statement_total(db, base)
    state_order = case(
        (Submission.id.is_(None), 0),
        (Submission.status == "submitted", 1),
        (Submission.status == "returned", 2),
        else_=3,
    )
    rows = db.execute(
        base.order_by(
            state_order,
            case((effective_due_at.is_(None), 1), else_=0),
            effective_due_at,
            Assignment.id,
        )
        .limit(limit)
        .offset(offset)
    ).all()
    items = []
    for assignment, course, unit, submission, due_at in rows:
        items.append(
            {
                "assignment_id": assignment.id,
                "course_id": course.id,
                "course_title": course.title,
                "course_unit_id": unit.id,
                "unit_title": unit.title,
                "title": assignment.title,
                "due_at": due_at,
                "state": submission.status if submission is not None else "pending",
                "score": submission.score if submission is not None else None,
                "feedback": submission.feedback if submission is not None else None,
            }
        )
    return _page(items, total, limit, offset)


def _student_continue_learning(db: Session, student_id: int) -> dict | None:
    row = db.execute(
        select(LearningResumeProjection, Course, CourseUnit)
        .join(
            CourseEnrollment,
            CourseEnrollment.course_id == LearningResumeProjection.course_id,
        )
        .join(Course, Course.id == LearningResumeProjection.course_id)
        .join(CourseUnit, CourseUnit.id == LearningResumeProjection.course_unit_id)
        .where(
            LearningResumeProjection.subject_user_id == student_id,
            CourseEnrollment.student_id == student_id,
            CourseEnrollment.status == "active",
            Course.status == "published",
        )
        .order_by(
            LearningResumeProjection.last_occurred_at.desc(),
            LearningResumeProjection.id.desc(),
        )
        .limit(1)
    ).first()
    if row is None:
        return None
    resume, course, unit = row
    return {
        "course_id": course.id,
        "course_title": course.title,
        "course_unit_id": unit.id,
        "unit_title": unit.title,
        "activity_key": resume.activity_key,
        "last_occurred_at": resume.last_occurred_at,
        "cursor": dict(resume.cursor_json or {}),
    }


def _student_submission_summary(db: Session, student_id: int) -> dict[str, int]:
    rows = db.execute(
        select(Submission.status, func.count(Submission.id))
        .select_from(Submission)
        .join(Assignment, Assignment.id == Submission.assignment_id)
        .join(CourseUnit, CourseUnit.id == Assignment.unit_id)
        .join(CourseEnrollment, CourseEnrollment.course_id == CourseUnit.course_id)
        .join(ClassGroup, ClassGroup.id == Submission.class_id)
        .where(
            Submission.student_id == student_id,
            CourseEnrollment.student_id == student_id,
            CourseEnrollment.status == "active",
            ClassGroup.kind == "course_cohort",
        )
        .group_by(Submission.status)
    ).all()
    result = {"submitted": 0, "graded": 0, "returned": 0}
    for status, count in rows:
        if status in result:
            result[status] = int(count)
    return result


def _student_homerooms(db: Session, student_id: int, limit: int, offset: int) -> dict:
    base = (
        select(ClassGroup)
        .join(ClassMembership, ClassMembership.class_id == ClassGroup.id)
        .where(
            ClassMembership.user_id == student_id,
            ClassMembership.role == "student",
            ClassMembership.status == "active",
            ClassGroup.kind == "homeroom",
            ClassGroup.status == "active",
        )
    )
    total = _statement_total(db, base)
    classes = list(
        db.scalars(
            base.order_by(ClassGroup.name, ClassGroup.id).limit(limit).offset(offset)
        ).all()
    )
    items = [
        {
            "class_id": item.id,
            "name": item.name,
            "grade": item.grade,
            "term": item.term,
        }
        for item in classes
    ]
    return _page(items, total, limit, offset)


def _teacher_courses(db: Session, teacher_id: int, limit: int, offset: int) -> dict:
    visible = _teacher_course_condition(teacher_id)
    latest_release_number = _latest_release_number_subquery()
    latest_release_draft = _latest_release_draft_subquery()
    active_students = (
        select(func.count(CourseEnrollment.id))
        .where(
            CourseEnrollment.course_id == Course.id,
            CourseEnrollment.status == "active",
        )
        .correlate(Course)
        .scalar_subquery()
    )
    pending_students = (
        select(func.count(CourseJoinRequest.id))
        .where(
            CourseJoinRequest.course_id == Course.id,
            CourseJoinRequest.status == "pending",
        )
        .correlate(Course)
        .scalar_subquery()
    )
    base = select(
        Course,
        latest_release_number.label("latest_release_number"),
        latest_release_draft.label("latest_release_draft"),
        active_students.label("active_students"),
        pending_students.label("pending_students"),
    ).where(visible)
    total = _statement_total(db, base)
    rows = db.execute(
        base.order_by(
            case((Course.status == "published", 0), else_=1),
            Course.updated_at.desc(),
            Course.id.desc(),
        )
        .limit(limit)
        .offset(offset)
    ).all()
    items = []
    for course, release_number, release_draft, student_count, pending_count in rows:
        items.append(
            {
                "course_id": course.id,
                "title": course.title,
                "status": course.status,
                "course_code": course.course_code,
                "galaxy_key": course.galaxy_key,
                "subject_key": course.subject_key,
                "current_release_number": release_number,
                "content_draft_revision": int(course.content_draft_revision or 0),
                "has_unpublished_changes": _has_unpublished_changes(
                    int(course.content_draft_revision or 0),
                    release_draft,
                ),
                "active_student_count": int(student_count or 0),
                "pending_student_count": int(pending_count or 0),
            }
        )
    return _page(items, total, limit, offset)


def _teacher_pending_students(
    db: Session, teacher_id: int, limit: int, offset: int
) -> dict:
    base = (
        select(CourseJoinRequest, Course, User, ClassGroup)
        .join(Course, Course.id == CourseJoinRequest.course_id)
        .join(User, User.id == CourseJoinRequest.student_id)
        .outerjoin(ClassGroup, ClassGroup.id == CourseJoinRequest.source_class_id)
        .where(
            _teacher_course_condition(teacher_id),
            CourseJoinRequest.status == "pending",
        )
    )
    total = _statement_total(db, base)
    rows = db.execute(
        base.order_by(CourseJoinRequest.created_at, CourseJoinRequest.id)
        .limit(limit)
        .offset(offset)
    ).all()
    items = [
        {
            "request_id": request.id,
            "course_id": course.id,
            "course_title": course.title,
            "student_id": student.id,
            "student_display_name": student.display_name,
            "source_class_name": source_class.name
            if source_class is not None
            else "未关联班级",
            "requested_at": request.created_at,
        }
        for request, course, student, source_class in rows
    ]
    return _page(items, total, limit, offset)


def _teacher_unpublished_drafts(
    db: Session, teacher_id: int, limit: int, offset: int
) -> dict:
    latest_release_number = _latest_release_number_subquery()
    latest_release_draft = _latest_release_draft_subquery()
    has_changes = or_(
        and_(
            latest_release_number.is_(None),
            Course.content_draft_revision > 0,
        ),
        and_(
            latest_release_number.is_not(None),
            Course.content_draft_revision > latest_release_draft + 1,
        ),
    )
    base = select(
        Course,
        latest_release_number.label("latest_release_number"),
        latest_release_draft.label("latest_release_draft"),
    ).where(_teacher_course_condition(teacher_id), has_changes)
    total = _statement_total(db, base)
    rows = db.execute(
        base.order_by(Course.updated_at.desc(), Course.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    items = [
        {
            "course_id": course.id,
            "course_title": course.title,
            "content_draft_revision": int(course.content_draft_revision or 0),
            "current_release_number": release_number,
            "last_published_draft_revision": release_draft,
            "updated_at": course.updated_at,
        }
        for course, release_number, release_draft in rows
    ]
    return _page(items, total, limit, offset)


def _teacher_pending_grading(
    db: Session, teacher_id: int, limit: int, offset: int
) -> dict:
    base = (
        select(Submission, Assignment, CourseUnit, Course, User, ClassGroup)
        .join(Assignment, Assignment.id == Submission.assignment_id)
        .join(CourseUnit, CourseUnit.id == Assignment.unit_id)
        .join(Course, Course.id == CourseUnit.course_id)
        .join(User, User.id == Submission.student_id)
        .join(ClassGroup, ClassGroup.id == Submission.class_id)
        .where(
            _teacher_course_condition(teacher_id),
            Submission.status == "submitted",
            ClassGroup.kind == "course_cohort",
        )
    )
    total = _statement_total(db, base)
    rows = db.execute(
        base.order_by(Submission.submitted_at, Submission.id)
        .limit(limit)
        .offset(offset)
    ).all()
    items = [
        {
            "submission_id": submission.id,
            "class_id": class_group.id,
            "assignment_id": assignment.id,
            "assignment_title": assignment.title,
            "course_id": course.id,
            "course_title": course.title,
            "course_unit_id": unit.id,
            "unit_title": unit.title,
            "student_id": student.id,
            "student_display_name": student.display_name,
            "submitted_at": submission.submitted_at,
        }
        for submission, assignment, unit, course, student, class_group in rows
    ]
    return _page(items, total, limit, offset)


def _admin_pending_teacher_applications(db: Session, limit: int, offset: int) -> dict:
    base = (
        select(TeacherApplication, User)
        .join(User, User.id == TeacherApplication.user_id)
        .where(TeacherApplication.status == "pending")
    )
    total = _statement_total(db, base)
    rows = db.execute(
        base.order_by(TeacherApplication.created_at, TeacherApplication.id)
        .limit(limit)
        .offset(offset)
    ).all()
    items = [
        {
            "application_id": application.id,
            "user_id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "message": application.message,
            "submitted_at": application.created_at,
        }
        for application, user in rows
    ]
    return _page(items, total, limit, offset)


def _admin_pending_course_revisions(db: Session, limit: int, offset: int) -> dict:
    base = (
        select(CourseInformationRevision, Course)
        .join(Course, Course.id == CourseInformationRevision.course_id)
        .where(CourseInformationRevision.status == "submitted")
    )
    total = _statement_total(db, base)
    rows = db.execute(
        base.order_by(
            CourseInformationRevision.submitted_at,
            CourseInformationRevision.id,
        )
        .limit(limit)
        .offset(offset)
    ).all()
    items = [
        {
            "revision_id": revision.id,
            "course_id": course.id,
            "course_title": course.title,
            "revision_number": revision.revision_number,
            "school_id": course.school_id,
            "submitted_at": revision.submitted_at or revision.created_at,
        }
        for revision, course in rows
    ]
    return _page(items, total, limit, offset)


def _admin_organization_alerts(db: Session, limit: int, offset: int) -> dict:
    schools = list(db.scalars(select(School).where(School.status != "active")).all())
    classes = list(
        db.scalars(
            select(ClassGroup).where(
                ClassGroup.kind == "homeroom",
                ClassGroup.status != "active",
            )
        ).all()
    )
    items = [
        {
            "kind": "school",
            "resource_id": item.id,
            "name": item.name,
            "status": item.status,
            "school_id": item.id,
        }
        for item in schools
    ] + [
        {
            "kind": "class",
            "resource_id": item.id,
            "name": item.name,
            "status": item.status,
            "school_id": item.school_id,
        }
        for item in classes
    ]
    items.sort(key=lambda item: (item["kind"], item["resource_id"]))
    total = len(items)
    return _page(items[offset : offset + limit], total, limit, offset)


def _admin_catalog_totals(db: Session) -> dict[str, int]:
    return {
        "users": int(db.scalar(select(func.count(User.id))) or 0),
        "courses": int(db.scalar(select(func.count(Course.id))) or 0),
        "active_schools": int(
            db.scalar(select(func.count(School.id)).where(School.status == "active"))
            or 0
        ),
        "active_homerooms": int(
            db.scalar(
                select(func.count(ClassGroup.id)).where(
                    ClassGroup.kind == "homeroom",
                    ClassGroup.status == "active",
                )
            )
            or 0
        ),
    }


def _empty_admin_teaching_snapshot() -> dict[str, Any]:
    return {
        "published_courses": 0,
        "draft_courses": 0,
        "active_enrollments": 0,
        "immutable_releases": 0,
        "released_units": 0,
        "completed_activities": 0,
        "pending_grading": 0,
        "galaxy_distribution": [
            {
                "galaxy_key": galaxy_key,
                "courses": 0,
                "active_enrollments": 0,
                "releases": 0,
            }
            for galaxy_key in ("englab", "code-space", "future-galaxy")
        ],
        "course_pulse": [],
    }


def _admin_teaching_snapshot(db: Session) -> dict[str, Any]:
    """Read existing teaching facts for the admin showcase; no new state is stored."""

    published_courses = int(
        db.scalar(select(func.count(Course.id)).where(Course.status == "published"))
        or 0
    )
    draft_courses = int(
        db.scalar(select(func.count(Course.id)).where(Course.status == "draft")) or 0
    )
    active_enrollments = int(
        db.scalar(
            select(func.count(CourseEnrollment.id)).where(
                CourseEnrollment.status == "active"
            )
        )
        or 0
    )
    immutable_releases = int(db.scalar(select(func.count(CourseRelease.id))) or 0)
    released_units = int(db.scalar(select(func.count(CourseReleaseUnit.id))) or 0)
    completed_activities = int(
        db.scalar(
            select(func.count(LearningActivityProjection.id)).where(
                LearningActivityProjection.status == "completed"
            )
        )
        or 0
    )
    pending_grading = int(
        db.scalar(
            select(func.count(Submission.id)).where(Submission.status == "submitted")
        )
        or 0
    )

    course_counts = {
        str(galaxy_key): int(total)
        for galaxy_key, total in db.execute(
            select(Course.galaxy_key, func.count(Course.id))
            .where(Course.status == "published")
            .group_by(Course.galaxy_key)
        ).all()
    }
    enrollment_counts = {
        str(galaxy_key): int(total)
        for galaxy_key, total in db.execute(
            select(Course.galaxy_key, func.count(CourseEnrollment.id))
            .join(Course, Course.id == CourseEnrollment.course_id)
            .where(
                Course.status == "published",
                CourseEnrollment.status == "active",
            )
            .group_by(Course.galaxy_key)
        ).all()
    }
    release_counts = {
        str(galaxy_key): int(total)
        for galaxy_key, total in db.execute(
            select(Course.galaxy_key, func.count(CourseRelease.id))
            .join(Course, Course.id == CourseRelease.course_id)
            .where(Course.status == "published")
            .group_by(Course.galaxy_key)
        ).all()
    }
    known_galaxies = ["englab", "code-space", "future-galaxy"]
    extra_galaxies = sorted(
        (set(course_counts) | set(enrollment_counts) | set(release_counts))
        - set(known_galaxies)
    )
    galaxy_distribution = [
        {
            "galaxy_key": galaxy_key,
            "courses": course_counts.get(galaxy_key, 0),
            "active_enrollments": enrollment_counts.get(galaxy_key, 0),
            "releases": release_counts.get(galaxy_key, 0),
        }
        for galaxy_key in [*known_galaxies, *extra_galaxies]
    ]

    recent_courses = list(
        db.scalars(
            select(Course)
            .where(Course.status == "published")
            .order_by(Course.updated_at.desc(), Course.id.desc())
            .limit(6)
        ).all()
    )
    course_pulse: list[dict[str, Any]] = []
    for course in recent_courses:
        latest_release = db.scalar(
            select(CourseRelease)
            .where(CourseRelease.course_id == course.id)
            .order_by(CourseRelease.release_number.desc(), CourseRelease.id.desc())
            .limit(1)
        )
        student_count = int(
            db.scalar(
                select(func.count(CourseEnrollment.id)).where(
                    CourseEnrollment.course_id == course.id,
                    CourseEnrollment.status == "active",
                )
            )
            or 0
        )
        unit_count = (
            int(
                db.scalar(
                    select(func.count(CourseReleaseUnit.id)).where(
                        CourseReleaseUnit.course_release_id == latest_release.id
                    )
                )
                or 0
            )
            if latest_release is not None
            else 0
        )
        completed_count = int(
            db.scalar(
                select(func.count(LearningActivityProjection.id)).where(
                    LearningActivityProjection.course_id == course.id,
                    LearningActivityProjection.status == "completed",
                )
            )
            or 0
        )
        course_pending_grading = int(
            db.scalar(
                select(func.count(Submission.id))
                .join(Assignment, Assignment.id == Submission.assignment_id)
                .join(CourseUnit, CourseUnit.id == Assignment.unit_id)
                .where(
                    CourseUnit.course_id == course.id,
                    Submission.status == "submitted",
                )
            )
            or 0
        )
        expected_count = student_count * unit_count
        progress_percent = (
            min(100, round(completed_count / expected_count * 100))
            if expected_count
            else 0
        )
        course_pulse.append(
            {
                "course_id": course.id,
                "title": course.title,
                "galaxy_key": course.galaxy_key,
                "subject_key": course.subject_key,
                "current_release_number": (
                    latest_release.release_number if latest_release is not None else None
                ),
                "active_student_count": student_count,
                "published_unit_count": unit_count,
                "completed_activity_count": completed_count,
                "pending_grading_count": course_pending_grading,
                "progress_percent": progress_percent,
            }
        )

    return {
        "published_courses": published_courses,
        "draft_courses": draft_courses,
        "active_enrollments": active_enrollments,
        "immutable_releases": immutable_releases,
        "released_units": released_units,
        "completed_activities": completed_activities,
        "pending_grading": pending_grading,
        "galaxy_distribution": galaxy_distribution,
        "course_pulse": course_pulse,
    }


def _student_primary_action(
    *,
    courses: dict,
    assignments: dict,
    continue_learning: dict | None,
) -> dict[str, Any]:
    pending = next(
        (item for item in assignments["items"] if item["state"] == "pending"),
        None,
    )
    if pending is not None:
        return {
            "kind": "continue_assignment",
            "label": f"完成作业：{pending['title']}",
            "section": "assignments",
            "course_id": pending["course_id"],
            "course_unit_id": pending["course_unit_id"],
            "assignment_id": pending["assignment_id"],
        }
    if continue_learning is not None:
        return {
            "kind": "continue_learning",
            "label": f"继续学习：{continue_learning['unit_title']}",
            "section": "continue_learning",
            "course_id": continue_learning["course_id"],
            "course_unit_id": continue_learning["course_unit_id"],
        }
    if courses["items"]:
        course = courses["items"][0]
        return {
            "kind": "open_course",
            "label": f"打开课程：{course['title']}",
            "section": "courses",
            "course_id": course["course_id"],
        }
    return {
        "kind": "join_course",
        "label": "加入一门课程",
        "section": "courses",
    }


def _teacher_primary_action(
    *,
    courses: dict,
    pending_students: dict,
    unpublished_drafts: dict,
    pending_grading: dict,
) -> dict[str, Any]:
    if pending_students["items"]:
        item = pending_students["items"][0]
        return {
            "kind": "review_course_join_request",
            "label": f"审批学生：{item['student_display_name']}",
            "section": "pending_students",
            "course_id": item["course_id"],
            "request_id": item["request_id"],
        }
    if unpublished_drafts["items"]:
        item = unpublished_drafts["items"][0]
        return {
            "kind": "continue_course_draft",
            "label": f"继续备课：{item['course_title']}",
            "section": "unpublished_drafts",
            "course_id": item["course_id"],
        }
    if pending_grading["items"]:
        item = pending_grading["items"][0]
        return {
            "kind": "grade_submission",
            "label": f"批改作业：{item['assignment_title']}",
            "section": "pending_grading",
            "course_id": item["course_id"],
            "course_unit_id": item["course_unit_id"],
            "assignment_id": item["assignment_id"],
            "class_id": item["class_id"],
            "submission_id": item["submission_id"],
        }
    if courses["items"]:
        item = courses["items"][0]
        return {
            "kind": "open_teaching_course",
            "label": f"管理课程：{item['title']}",
            "section": "courses",
            "course_id": item["course_id"],
        }
    return {
        "kind": "create_course",
        "label": "创建授课课程",
        "section": "courses",
    }


def _admin_primary_action(
    *,
    applications: dict,
    revisions: dict,
    alerts: dict,
) -> dict[str, Any]:
    if applications["items"]:
        item = applications["items"][0]
        return {
            "kind": "review_teacher_application",
            "label": f"审核教师申请：{item['display_name']}",
            "section": "pending_teacher_applications",
            "request_id": item["application_id"],
        }
    if revisions["items"]:
        item = revisions["items"][0]
        return {
            "kind": "review_course_information",
            "label": f"审核课程：{item['course_title']}",
            "section": "pending_course_revisions",
            "course_id": item["course_id"],
            "revision_id": item["revision_id"],
        }
    if alerts["items"]:
        item = alerts["items"][0]
        return {
            "kind": "review_organization_alert",
            "label": f"查看组织提醒：{item['name']}",
            "section": "organization_alerts",
        }
    return {
        "kind": "open_governance",
        "label": "查看治理总览",
        "section": "catalog_totals",
    }


def _teacher_course_condition(teacher_id: int):
    active_school_membership = select(SchoolMembership.id).where(
        SchoolMembership.school_id == Course.school_id,
        SchoolMembership.user_id == teacher_id,
        SchoolMembership.role.in_(["teacher", "admin"]),
        SchoolMembership.status == "active",
    )
    collaborator = select(CourseCollaborator.id).where(
        CourseCollaborator.course_id == Course.id,
        CourseCollaborator.user_id == teacher_id,
        CourseCollaborator.status == "active",
    )
    return and_(
        active_school_membership.exists(),
        or_(Course.creator_user_id == teacher_id, collaborator.exists()),
    )


def _latest_release_number_subquery():
    return (
        select(CourseRelease.release_number)
        .where(CourseRelease.course_id == Course.id)
        .order_by(CourseRelease.release_number.desc(), CourseRelease.id.desc())
        .limit(1)
        .correlate(Course)
        .scalar_subquery()
    )


def _latest_release_draft_subquery():
    return (
        select(CourseRelease.draft_revision)
        .where(CourseRelease.course_id == Course.id)
        .order_by(CourseRelease.release_number.desc(), CourseRelease.id.desc())
        .limit(1)
        .correlate(Course)
        .scalar_subquery()
    )


def _has_unpublished_changes(current_revision: int, release_draft: int | None) -> bool:
    if release_draft is None:
        return current_revision > 0
    return current_revision > int(release_draft) + 1


def _safe_section(
    db: Session,
    *,
    issues: list[dict[str, str]],
    section: str,
    loader: Callable[[], Any],
    fallback: Callable[[], Any],
) -> Any:
    try:
        return loader()
    except Exception:
        db.rollback()
        logger.exception("Workbench section %s could not be loaded", section)
        issues.append(
            {
                "section": section,
                "code": "section_unavailable",
                "message": "该部分暂时无法读取，其他工作台内容仍可使用",
            }
        )
        return fallback()


def _statement_total(db: Session, statement) -> int:
    return int(
        db.scalar(select(func.count()).select_from(statement.order_by(None).subquery()))
        or 0
    )


def _page(items: list[dict], total: int, limit: int, offset: int) -> dict[str, Any]:
    next_offset = offset + len(items) if offset + len(items) < total else None
    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
        "next_offset": next_offset,
    }


def _empty_page(limit: int, offset: int) -> dict[str, Any]:
    return _page([], 0, limit, offset)
