from typing import Any

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.models import (
    Assignment,
    AssignmentClassPolicy,
    ClassGroup,
    ClassMembership,
    Course,
    CourseClass,
    CourseUnit,
    LearningEvent,
    PointLedger,
    School,
    SchoolMembership,
    Submission,
)
from app.schemas.admin import AdminClassStats, AdminSchoolStats
from app.services.admin_common import PENDING_SUBMISSION_STATUSES, count_rows
from app.services.assignment_policies import (
    assignment_class_effective_status_expression,
    assignment_class_is_assigned_expression,
)


def build_school_stats(db: Session, school: School) -> AdminSchoolStats:
    return AdminSchoolStats(
        school_id=school.id,
        school_name=school.name,
        region=school.region,
        status=school.status,
        total_classes=count_rows(
            db,
            ClassGroup,
            ClassGroup.school_id == school.id,
            ClassGroup.kind == "homeroom",
        ),
        active_classes=count_rows(
            db,
            ClassGroup,
            ClassGroup.school_id == school.id,
            ClassGroup.kind == "homeroom",
            ClassGroup.status == "active",
        ),
        active_students=_distinct_count(
            db,
            SchoolMembership.user_id,
            SchoolMembership.school_id == school.id,
            SchoolMembership.role == "student",
            SchoolMembership.status == "active",
        ),
        active_teachers=_distinct_count(
            db,
            SchoolMembership.user_id,
            SchoolMembership.school_id == school.id,
            SchoolMembership.role.in_(["admin", "teacher"]),
            SchoolMembership.status == "active",
        ),
        total_courses=count_rows(db, Course, Course.school_id == school.id),
        active_courses=count_rows(db, Course, Course.school_id == school.id, Course.status != "archived"),
        total_assignments=_school_assignment_count(db, school.id),
        active_assignments=_school_assignment_count(db, school.id, active_only=True),
        total_learning_events=count_rows(db, LearningEvent, LearningEvent.school_id == school.id),
        complete_learning_events=count_rows(
            db,
            LearningEvent,
            LearningEvent.school_id == school.id,
            LearningEvent.event_type == "complete",
        ),
        total_submissions=_school_submission_count(db, school.id),
        graded_submissions=_school_submission_count(db, school.id, statuses=["graded"]),
        returned_submissions=_school_submission_count(db, school.id, statuses=["returned"]),
        pending_submissions=_school_submission_count(db, school.id, statuses=PENDING_SUBMISSION_STATUSES),
        total_points=_sum_int(db, PointLedger.delta, PointLedger.school_id == school.id),
    )


def build_class_stats(db: Session, class_group: ClassGroup) -> AdminClassStats:
    active_students = _distinct_count(
        db,
        ClassMembership.user_id,
        ClassMembership.class_id == class_group.id,
        ClassMembership.role == "student",
        ClassMembership.status == "active",
    )
    active_assignments = _class_assignment_count(db, class_group.id, active_only=True)
    expected_submissions = active_students * active_assignments
    pending_submissions = count_rows(
        db,
        Submission,
        Submission.class_id == class_group.id,
        Submission.status.in_(PENDING_SUBMISSION_STATUSES),
    )
    total_points = _sum_int(db, PointLedger.delta, PointLedger.class_id == class_group.id)
    return AdminClassStats(
        class_id=class_group.id,
        class_name=class_group.name,
        school_id=class_group.school_id,
        grade=class_group.grade,
        term=class_group.term,
        status=class_group.status,
        active_students=active_students,
        active_teachers=_distinct_count(
            db,
            ClassMembership.user_id,
            ClassMembership.class_id == class_group.id,
            ClassMembership.role.in_(["admin", "teacher"]),
            ClassMembership.status == "active",
        ),
        active_courses=_class_course_count(db, class_group.id),
        active_assignments=active_assignments,
        expected_submissions=expected_submissions,
        total_learning_events=count_rows(db, LearningEvent, LearningEvent.class_id == class_group.id),
        complete_learning_events=count_rows(
            db,
            LearningEvent,
            LearningEvent.class_id == class_group.id,
            LearningEvent.event_type == "complete",
        ),
        total_submissions=count_rows(db, Submission, Submission.class_id == class_group.id),
        graded_submissions=count_rows(
            db,
            Submission,
            Submission.class_id == class_group.id,
            Submission.status == "graded",
        ),
        returned_submissions=count_rows(
            db,
            Submission,
            Submission.class_id == class_group.id,
            Submission.status == "returned",
        ),
        pending_submissions=pending_submissions,
        pending_submission_ratio=_divide(pending_submissions, expected_submissions),
        total_points=total_points,
        average_points_per_student=_divide(total_points, active_students),
        average_score_percent=_class_average_score_percent(db, class_group.id),
    )


def _distinct_count(db: Session, column: Any, *criteria: Any) -> int:
    statement = select(func.count(func.distinct(column)))
    for criterion in criteria:
        statement = statement.where(criterion)
    return int(db.scalar(statement) or 0)


def _sum_int(db: Session, column: Any, *criteria: Any) -> int:
    statement = select(func.coalesce(func.sum(column), 0))
    for criterion in criteria:
        statement = statement.where(criterion)
    return int(db.scalar(statement) or 0)


def _school_assignment_count(db: Session, school_id: int, active_only: bool = False) -> int:
    statement = (
        select(func.count(func.distinct(Assignment.id)))
        .select_from(Assignment)
        .join(CourseUnit, CourseUnit.id == Assignment.unit_id)
        .join(Course, Course.id == CourseUnit.course_id)
        .where(Course.school_id == school_id)
    )
    if active_only:
        statement = statement.where(Assignment.status == "active", Course.status != "archived")
    return int(db.scalar(statement) or 0)


def _class_course_count(db: Session, class_id: int) -> int:
    return int(
        db.scalar(
            select(func.count(func.distinct(Course.id)))
            .select_from(Course)
            .join(CourseClass, CourseClass.course_id == Course.id)
            .where(
                CourseClass.class_id == class_id,
                CourseClass.status == "active",
                Course.status != "archived",
            )
        )
        or 0
    )


def _class_assignment_count(db: Session, class_id: int, active_only: bool = False) -> int:
    statement = (
        select(func.count(func.distinct(Assignment.id)))
        .select_from(Assignment)
        .join(CourseUnit, CourseUnit.id == Assignment.unit_id)
        .join(Course, Course.id == CourseUnit.course_id)
        .join(CourseClass, CourseClass.course_id == Course.id)
        .outerjoin(
            AssignmentClassPolicy,
            and_(
                AssignmentClassPolicy.assignment_id == Assignment.id,
                AssignmentClassPolicy.class_id == CourseClass.class_id,
            ),
        )
        .where(
            CourseClass.class_id == class_id,
            CourseClass.status == "active",
            assignment_class_is_assigned_expression(),
        )
    )
    if active_only:
        statement = statement.where(
            assignment_class_effective_status_expression() == "active",
            Course.status == "published",
            CourseUnit.status == "published",
        )
    return int(db.scalar(statement) or 0)


def _school_submission_count(
    db: Session,
    school_id: int,
    statuses: list[str] | tuple[str, ...] | None = None,
) -> int:
    statement = (
        select(func.count(func.distinct(Submission.id)))
        .select_from(Submission)
        .join(Assignment, Assignment.id == Submission.assignment_id)
        .join(CourseUnit, CourseUnit.id == Assignment.unit_id)
        .join(Course, Course.id == CourseUnit.course_id)
        .where(Course.school_id == school_id)
    )
    if statuses is not None:
        statement = statement.where(Submission.status.in_(statuses))
    return int(db.scalar(statement) or 0)


def _class_average_score_percent(db: Session, class_id: int) -> float:
    score_total, max_score_total = db.execute(
        select(
            func.coalesce(func.sum(Submission.score), 0),
            func.coalesce(func.sum(Assignment.max_score), 0),
        )
        .select_from(Submission)
        .join(Assignment, Assignment.id == Submission.assignment_id)
        .where(Submission.class_id == class_id, Submission.status == "graded")
    ).one()
    return round(_divide(float(score_total or 0), float(max_score_total or 0)) * 100, 2)


def _divide(numerator: int | float, denominator: int | float) -> float:
    if not denominator:
        return 0.0
    return round(float(numerator) / float(denominator), 4)
