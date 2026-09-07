"""Shared, read-only completion population for current course workbenches.

A completion counts once per enrolled learner and released unit, under the
current release's rule and internal teaching scope. Historical projections stay
in storage; changing presentation scope must never delete learning evidence.
"""

from sqlalchemy import and_, func, select
from sqlalchemy.sql.selectable import Subquery

from app.models import (
    ClassGroup,
    Course,
    CourseClass,
    CourseEnrollment,
    CourseRelease,
    CourseReleaseUnit,
    LearningActivityProjection,
    LearningCompletionRule,
    LearningRuleClassBinding,
)

from app.services.learning_evidence_access import effective_rule_binding_statement


def current_course_releases() -> Subquery:
    """Select one immutable release per course without loading entire packages."""
    latest_numbers = (
        select(
            CourseRelease.course_id,
            func.max(CourseRelease.release_number).label("release_number"),
        )
        .group_by(CourseRelease.course_id)
        .subquery("latest_release_numbers")
    )
    return (
        select(
            CourseRelease.id.label("release_id"),
            CourseRelease.course_id,
            CourseRelease.completion_rule_id,
        )
        .join(
            latest_numbers,
            and_(
                CourseRelease.course_id == latest_numbers.c.course_id,
                CourseRelease.release_number == latest_numbers.c.release_number,
            ),
        )
        .subquery("current_course_releases")
    )


def current_completed_units() -> Subquery:
    """Return distinct (course, student, unit) rows for current completion counts.

    Use released unit identities, not mutable drafts: unpublished changes must
    not change student credit. A new release that reuses the same completion
    rule retains credit; a new rule does not inherit old-rule completions.
    `transferred` is a successful outcome, consistently with student progress.
    """
    release = current_course_releases()
    effective_pin_id = (
        effective_rule_binding_statement(CourseClass.id, CourseClass.plan_version)
        .with_only_columns(LearningRuleClassBinding.id)
        .correlate(CourseClass)
        .scalar_subquery()
    )
    projection = LearningActivityProjection
    return (
        select(
            projection.course_id,
            projection.subject_user_id.label("student_id"),
            projection.course_unit_id,
        )
        .join(Course, Course.id == projection.course_id)
        .join(release, release.c.course_id == Course.id)
        .join(
            CourseReleaseUnit,
            and_(
                CourseReleaseUnit.course_release_id == release.c.release_id,
                CourseReleaseUnit.source_course_unit_id == projection.course_unit_id,
                CourseReleaseUnit.activity_key == projection.activity_key,
            ),
        )
        .join(
            CourseEnrollment,
            and_(
                CourseEnrollment.course_id == Course.id,
                CourseEnrollment.student_id == projection.subject_user_id,
                CourseEnrollment.status == "active",
            ),
        )
        .join(
            CourseClass,
            and_(
                CourseClass.course_id == Course.id,
                CourseClass.class_id == projection.class_id,
                CourseClass.status == "active",
            ),
        )
        .join(ClassGroup, ClassGroup.id == CourseClass.class_id)
        .join(
            LearningCompletionRule,
            and_(
                LearningCompletionRule.id == release.c.completion_rule_id,
                LearningCompletionRule.id == projection.rule_id,
                LearningCompletionRule.course_id == Course.id,
                LearningCompletionRule.version_number == projection.rule_version,
            ),
        )
        .join(
            LearningRuleClassBinding,
            and_(
                LearningRuleClassBinding.course_class_id == CourseClass.id,
                LearningRuleClassBinding.id == effective_pin_id,
                LearningRuleClassBinding.rule_id == projection.rule_id,
                LearningRuleClassBinding.rule_version == projection.rule_version,
            ),
        )
        .where(
            Course.status == "published",
            ClassGroup.kind == "course_cohort",
            ClassGroup.status == "active",
            ClassGroup.school_id == Course.school_id,
            projection.school_id == Course.school_id,
            projection.status.in_(["completed", "transferred"]),
        )
        .distinct()
        .subquery("current_completed_units")
    )
