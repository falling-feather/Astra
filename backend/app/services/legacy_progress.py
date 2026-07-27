"""Compatibility progress envelopes backed by authoritative completion data."""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.models import (
    Assignment,
    AssignmentClassPolicy,
    ClassMembership,
    Course,
    CourseClass,
    CourseUnit,
    CourseUnitClassPlan,
    LearningEvent,
    PointLedger,
    Submission,
    User,
)
from app.schemas.course import ProgressSummary
from app.services.assignment_policies import (
    assignment_class_effective_status_expression,
    assignment_class_is_assigned_expression,
)
from app.services.learning_evidence_access import (
    authoritative_projection_counts,
)


def require_active_student_progress_target(
    db: Session,
    *,
    user_id: int,
    class_id: int,
) -> None:
    target_membership = db.scalar(
        select(ClassMembership.id)
        .join(User, User.id == ClassMembership.user_id)
        .where(
            ClassMembership.class_id == class_id,
            ClassMembership.user_id == user_id,
            ClassMembership.role == "student",
            ClassMembership.status == "active",
            User.role == "student",
            User.status == "active",
        )
    )
    if target_membership is None:
        raise HTTPException(
            status_code=403,
            detail="User is outside requested class scope",
        )


def build_progress_summary(
    db: Session,
    user_id: int,
    class_id: int | None,
    *,
    class_ids: list[int] | None = None,
    student_visible_resources: bool = False,
) -> ProgressSummary:
    submissions = select(Submission).where(Submission.student_id == user_id)
    graded_submissions = select(Submission).where(
        Submission.student_id == user_id,
        Submission.status == "graded",
    )
    events = select(LearningEvent).where(LearningEvent.user_id == user_id)
    points = select(func.coalesce(func.sum(PointLedger.delta), 0)).where(
        PointLedger.user_id == user_id
    )
    if class_id is not None:
        submissions = submissions.where(Submission.class_id == class_id)
        graded_submissions = graded_submissions.where(
            Submission.class_id == class_id
        )
        events = events.where(LearningEvent.class_id == class_id)
        points = points.where(PointLedger.class_id == class_id)
    elif class_ids is not None:
        submissions = submissions.where(Submission.class_id.in_(class_ids))
        graded_submissions = graded_submissions.where(
            Submission.class_id.in_(class_ids)
        )
        events = events.where(LearningEvent.class_id.in_(class_ids))
        points = points.where(PointLedger.class_id.in_(class_ids))
    if student_visible_resources:
        submissions = _student_visible_submission_filters(submissions)
        graded_submissions = _student_visible_submission_filters(
            graded_submissions
        )
        events = _student_visible_event_filters(events)
        points = _student_visible_point_filters(points)
    submitted_count = _count(db, submissions)
    graded_count = _count(db, graded_submissions)
    event_count = _count(db, events)
    projection_count, completed_count = authoritative_projection_counts(
        db,
        subject_user_id=user_id,
        class_ids=[class_id] if class_id is not None else (class_ids or []),
    )
    completion_percent = (
        round((completed_count / projection_count) * 100, 2)
        if projection_count
        else 0.0
    )
    return ProgressSummary(
        user_id=user_id,
        submitted_assignments=submitted_count,
        graded_assignments=graded_count,
        learning_events=event_count,
        completed_events=completed_count,
        total_points=int(db.scalar(points) or 0),
        completion_percent=completion_percent,
    )


def _count(db: Session, statement) -> int:
    return int(
        db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    )


def _student_visible_submission_filters(statement):
    return (
        statement.join(Assignment, Assignment.id == Submission.assignment_id)
        .join(CourseUnit, CourseUnit.id == Assignment.unit_id)
        .join(Course, Course.id == CourseUnit.course_id)
        .join(
            CourseClass,
            and_(
                CourseClass.course_id == Course.id,
                CourseClass.class_id == Submission.class_id,
            ),
        )
        .join(
            CourseUnitClassPlan,
            and_(
                CourseUnitClassPlan.course_class_id == CourseClass.id,
                CourseUnitClassPlan.course_unit_id == CourseUnit.id,
            ),
        )
        .outerjoin(
            AssignmentClassPolicy,
            and_(
                AssignmentClassPolicy.assignment_id == Assignment.id,
                AssignmentClassPolicy.class_id == Submission.class_id,
            ),
        )
        .where(
            Course.status == "published",
            CourseUnit.status == "published",
            CourseClass.status == "active",
            CourseUnitClassPlan.release_mode != "hidden",
            assignment_class_is_assigned_expression(),
            assignment_class_effective_status_expression() == "active",
        )
    )


def _student_visible_event_filters(statement):
    return (
        statement.outerjoin(Course, Course.id == LearningEvent.course_id)
        .outerjoin(CourseUnit, CourseUnit.id == LearningEvent.unit_id)
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
        .outerjoin(Assignment, Assignment.id == LearningEvent.assignment_id)
        .outerjoin(
            AssignmentClassPolicy,
            and_(
                AssignmentClassPolicy.assignment_id
                == LearningEvent.assignment_id,
                AssignmentClassPolicy.class_id == LearningEvent.class_id,
            ),
        )
        .where(
            or_(
                LearningEvent.course_id.is_(None),
                Course.status == "published",
            ),
            or_(
                LearningEvent.unit_id.is_(None),
                CourseUnit.status == "published",
            ),
            or_(
                LearningEvent.unit_id.is_(None),
                and_(
                    CourseClass.status == "active",
                    CourseUnitClassPlan.release_mode != "hidden",
                ),
            ),
            or_(
                LearningEvent.assignment_id.is_(None),
                and_(
                    assignment_class_is_assigned_expression(),
                    assignment_class_effective_status_expression() == "active",
                ),
            ),
        )
    )


def _student_visible_point_filters(statement):
    return (
        statement.outerjoin(Assignment, Assignment.id == PointLedger.assignment_id)
        .outerjoin(CourseUnit, CourseUnit.id == Assignment.unit_id)
        .outerjoin(Course, Course.id == CourseUnit.course_id)
        .outerjoin(
            CourseClass,
            and_(
                CourseClass.course_id == Course.id,
                CourseClass.class_id == PointLedger.class_id,
            ),
        )
        .outerjoin(
            CourseUnitClassPlan,
            and_(
                CourseUnitClassPlan.course_class_id == CourseClass.id,
                CourseUnitClassPlan.course_unit_id == CourseUnit.id,
            ),
        )
        .outerjoin(
            AssignmentClassPolicy,
            and_(
                AssignmentClassPolicy.assignment_id
                == PointLedger.assignment_id,
                AssignmentClassPolicy.class_id == PointLedger.class_id,
            ),
        )
        .where(
            or_(
                PointLedger.assignment_id.is_(None),
                and_(
                    Course.status == "published",
                    CourseUnit.status == "published",
                    CourseClass.status == "active",
                    CourseUnitClassPlan.release_mode != "hidden",
                    assignment_class_is_assigned_expression(),
                    assignment_class_effective_status_expression() == "active",
                ),
            )
        )
    )
