"""Read-only learning-evidence queries used by access and compatibility paths.

This module deliberately has no dependency on the learning-evidence write
service or on course-release services.  It is the narrow dependency boundary
for effective rule pins, authoritative completion projections, and isolated
legacy access entitlements.
"""

from __future__ import annotations

from collections.abc import Iterable

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Course,
    CourseClass,
    CourseUnit,
    CourseUnitClassPlan,
    LegacyAccessEntitlement,
    LearningActivityProjection,
    LearningCompletionRule,
    LearningRuleClassBinding,
)


COMPLETED_PROJECTION_STATUSES = ("completed", "transferred")


def effective_rule_binding(
    db: Session,
    course_class: CourseClass,
    *,
    locking_read: bool = False,
) -> LearningRuleClassBinding | None:
    """Return the latest immutable rule pin effective at the current plan."""
    return db.scalar(
        effective_rule_binding_statement(
            course_class.id,
            course_class.plan_version,
            locking_read=locking_read,
        )
    )


def effective_rule_binding_statement(
    course_class_id: int,
    plan_version: int,
    *,
    locking_read: bool = False,
):
    statement = (
        select(LearningRuleClassBinding)
        .where(
            LearningRuleClassBinding.course_class_id == course_class_id,
            LearningRuleClassBinding.plan_version <= plan_version,
        )
        .order_by(
            LearningRuleClassBinding.plan_version.desc(),
            LearningRuleClassBinding.id.desc(),
        )
        .limit(1)
    )
    return statement.with_for_update() if locking_read else statement


def effective_rule_bindings(
    db: Session,
    course_classes: Iterable[CourseClass],
    *,
    locking_read: bool = False,
) -> dict[int, LearningRuleClassBinding]:
    """Resolve effective pins for many course classes with one binding query."""
    course_class_by_id = {
        course_class.id: course_class
        for course_class in course_classes
        if course_class.id is not None
    }
    if not course_class_by_id:
        return {}
    statement = (
        select(LearningRuleClassBinding)
        .where(
            LearningRuleClassBinding.course_class_id.in_(course_class_by_id),
        )
        .order_by(
            LearningRuleClassBinding.course_class_id,
            LearningRuleClassBinding.plan_version.desc(),
            LearningRuleClassBinding.id.desc(),
        )
    )
    if locking_read:
        statement = statement.with_for_update()
    result: dict[int, LearningRuleClassBinding] = {}
    for binding in db.scalars(statement).all():
        course_class = course_class_by_id[binding.course_class_id]
        if (
            binding.plan_version <= course_class.plan_version
            and binding.course_class_id not in result
        ):
            result[binding.course_class_id] = binding
    return result


def effective_bound_rule(
    db: Session,
    *,
    course_class: CourseClass,
    binding: LearningRuleClassBinding,
    locking_read: bool = False,
) -> LearningCompletionRule:
    """Resolve and validate the redundant immutable binding coordinates."""
    statement = select(LearningCompletionRule).where(
        LearningCompletionRule.id == binding.rule_id,
        LearningCompletionRule.course_id == course_class.course_id,
        LearningCompletionRule.version_number == binding.rule_version,
        LearningCompletionRule.status == "active",
    )
    if locking_read:
        statement = statement.with_for_update()
    rule = db.scalar(statement.execution_options(populate_existing=True))
    if rule is None:
        raise HTTPException(
            status_code=409,
            detail="Completion rule binding is invalid",
        )
    return rule


def effective_bound_rules(
    db: Session,
    *,
    course_classes: Iterable[CourseClass],
    bindings: dict[int, LearningRuleClassBinding],
    locking_read: bool = False,
) -> dict[int, LearningCompletionRule]:
    """Validate many redundant binding coordinates with one rule query."""
    course_class_by_id = {
        course_class.id: course_class for course_class in course_classes
    }
    selected_bindings = {
        course_class_id: binding
        for course_class_id, binding in bindings.items()
        if course_class_id in course_class_by_id
    }
    if not selected_bindings:
        return {}
    statement = select(LearningCompletionRule).where(
        LearningCompletionRule.id.in_(
            {binding.rule_id for binding in selected_bindings.values()}
        )
    )
    if locking_read:
        statement = statement.with_for_update()
    rules_by_id = {
        rule.id: rule
        for rule in db.scalars(
            statement.execution_options(populate_existing=True)
        ).all()
    }
    result: dict[int, LearningCompletionRule] = {}
    for course_class_id, binding in selected_bindings.items():
        course_class = course_class_by_id[course_class_id]
        rule = rules_by_id.get(binding.rule_id)
        if (
            rule is None
            or rule.course_id != course_class.course_id
            or rule.version_number != binding.rule_version
            or rule.status != "active"
        ):
            raise HTTPException(
                status_code=409,
                detail="Completion rule binding is invalid",
            )
        result[course_class_id] = rule
    return result


def authoritative_activity_projections_by_subjects(
    db: Session,
    *,
    subject_user_ids: Iterable[int],
    class_id: int,
    course_id: int,
    locking_read: bool = False,
) -> dict[tuple[int, int], LearningActivityProjection]:
    """Return current-pin activity projections keyed by (subject, unit)."""
    subject_ids = set(subject_user_ids)
    if not subject_ids:
        return {}
    course_class_statement = select(CourseClass).where(
        CourseClass.class_id == class_id,
        CourseClass.course_id == course_id,
        CourseClass.status == "active",
    )
    if locking_read:
        course_class_statement = course_class_statement.with_for_update()
    course_class = db.scalar(course_class_statement)
    if course_class is None:
        return {}
    binding = effective_rule_binding(
        db,
        course_class,
        locking_read=locking_read,
    )
    if binding is None:
        return {}
    rule = effective_bound_rule(
        db,
        course_class=course_class,
        binding=binding,
        locking_read=locking_read,
    )
    projection_statement = select(LearningActivityProjection).where(
        LearningActivityProjection.subject_user_id.in_(subject_ids),
        LearningActivityProjection.class_id == class_id,
        LearningActivityProjection.course_id == course_id,
        LearningActivityProjection.rule_id == rule.id,
        LearningActivityProjection.rule_version == rule.version_number,
    )
    if locking_read:
        projection_statement = projection_statement.with_for_update()
    return {
        (projection.subject_user_id, projection.course_unit_id): projection
        for projection in db.scalars(projection_statement).all()
    }


def legacy_access_unit_ids_by_subjects(
    db: Session,
    *,
    subject_user_ids: Iterable[int],
    class_id: int,
    course_id: int,
    locking_read: bool = False,
) -> dict[int, set[int]]:
    """Return isolated legacy prerequisite access without completion semantics."""
    subject_ids = set(subject_user_ids)
    result = {subject_id: set() for subject_id in subject_ids}
    if not subject_ids:
        return result
    statement = (
        select(
            LegacyAccessEntitlement.subject_user_id,
            LegacyAccessEntitlement.prerequisite_unit_id,
        )
        .join(
            CourseUnit,
            CourseUnit.id == LegacyAccessEntitlement.prerequisite_unit_id,
        )
        .where(
            LegacyAccessEntitlement.subject_user_id.in_(subject_ids),
            LegacyAccessEntitlement.class_id == class_id,
            CourseUnit.course_id == course_id,
        )
    )
    if locking_read:
        statement = statement.with_for_update()
    for subject_user_id, prerequisite_unit_id in db.execute(statement).all():
        result[int(subject_user_id)].add(int(prerequisite_unit_id))
    return result


def prerequisite_access_unit_ids_by_subjects(
    db: Session,
    *,
    subject_user_ids: Iterable[int],
    class_id: int,
    course_id: int,
    locking_read: bool = False,
) -> dict[int, set[int]]:
    """Return access grants: current authoritative completion plus legacy rights."""
    subject_ids = set(subject_user_ids)
    result = {subject_id: set() for subject_id in subject_ids}
    projections = authoritative_activity_projections_by_subjects(
        db,
        subject_user_ids=subject_ids,
        class_id=class_id,
        course_id=course_id,
        locking_read=locking_read,
    )
    for (subject_user_id, course_unit_id), projection in projections.items():
        if projection.status in COMPLETED_PROJECTION_STATUSES:
            result[subject_user_id].add(course_unit_id)
    legacy = legacy_access_unit_ids_by_subjects(
        db,
        subject_user_ids=subject_ids,
        class_id=class_id,
        course_id=course_id,
        locking_read=locking_read,
    )
    for subject_user_id, unit_ids in legacy.items():
        result[subject_user_id].update(unit_ids)
    return result


def authoritative_prerequisite_unit_ids(
    db: Session,
    *,
    subject_user_id: int,
    class_id: int,
    course_id: int,
    locking_read: bool = False,
) -> set[int]:
    """Compatibility name for the access decision, including isolated legacy rights."""
    return prerequisite_access_unit_ids_by_subjects(
        db,
        subject_user_ids={subject_user_id},
        class_id=class_id,
        course_id=course_id,
        locking_read=locking_read,
    )[subject_user_id]


def authoritative_prerequisite_unit_ids_by_scope(
    db: Session,
    *,
    subject_user_id: int,
    scopes: set[tuple[int, int]],
) -> dict[tuple[int, int], set[int]]:
    """Resolve prerequisite access for multiple (class, course) scopes in bulk."""
    result = {scope: set() for scope in scopes}
    if not scopes:
        return result
    class_ids = {scope[0] for scope in scopes}
    course_ids = {scope[1] for scope in scopes}
    course_classes = [
        course_class
        for course_class in db.scalars(
            select(CourseClass).where(
                CourseClass.class_id.in_(class_ids),
                CourseClass.course_id.in_(course_ids),
                CourseClass.status == "active",
            )
        ).all()
        if (course_class.class_id, course_class.course_id) in scopes
    ]
    bindings = effective_rule_bindings(db, course_classes)
    rules = effective_bound_rules(
        db,
        course_classes=course_classes,
        bindings=bindings,
    )
    rule_scopes = {
        (
            course_class.class_id,
            course_class.course_id,
            rule.id,
            rule.version_number,
        )
        for course_class in course_classes
        if (rule := rules.get(course_class.id)) is not None
    }
    if rule_scopes:
        projections = db.scalars(
            select(LearningActivityProjection).where(
                LearningActivityProjection.subject_user_id == subject_user_id,
                LearningActivityProjection.class_id.in_(class_ids),
                LearningActivityProjection.course_id.in_(course_ids),
                LearningActivityProjection.rule_id.in_(
                    {scope[2] for scope in rule_scopes}
                ),
                LearningActivityProjection.status.in_(
                    COMPLETED_PROJECTION_STATUSES
                ),
            )
        ).all()
        for projection in projections:
            if (
                projection.class_id,
                projection.course_id,
                projection.rule_id,
                projection.rule_version,
            ) in rule_scopes:
                result[(projection.class_id, projection.course_id)].add(
                    projection.course_unit_id
                )
    legacy_rows = db.execute(
        select(
            LegacyAccessEntitlement.class_id,
            CourseUnit.course_id,
            LegacyAccessEntitlement.prerequisite_unit_id,
        )
        .join(
            CourseUnit,
            CourseUnit.id == LegacyAccessEntitlement.prerequisite_unit_id,
        )
        .where(
            LegacyAccessEntitlement.subject_user_id == subject_user_id,
            LegacyAccessEntitlement.class_id.in_(class_ids),
            CourseUnit.course_id.in_(course_ids),
        )
    ).all()
    for legacy_class_id, legacy_course_id, prerequisite_unit_id in legacy_rows:
        scope = (int(legacy_class_id), int(legacy_course_id))
        if scope in result:
            result[scope].add(int(prerequisite_unit_id))
    return result


def authoritative_projection_counts(
    db: Session,
    *,
    subject_user_id: int,
    class_ids: Iterable[int],
) -> tuple[int, int]:
    """Count published, non-hidden current-pin activities for progress APIs.

    Locked activities remain in the denominator because they are still part of
    the student's assigned completion scope; hidden and unpublished resources
    are never completion targets.
    """
    selected_class_ids = set(class_ids)
    if not selected_class_ids:
        return 0, 0
    course_classes = list(
        db.scalars(
            select(CourseClass).where(
                CourseClass.class_id.in_(selected_class_ids),
                CourseClass.status == "active",
            )
        ).all()
    )
    course_class_by_id = {
        course_class.id: course_class for course_class in course_classes
    }
    bindings = effective_rule_bindings(db, course_classes)
    rule_scopes = {
        (
            course_class.class_id,
            course_class.course_id,
            binding.rule_id,
            binding.rule_version,
        ): course_class
        for course_class in course_classes
        if (binding := bindings.get(course_class.id)) is not None
    }
    if not rule_scopes:
        return 0, 0
    rules_by_course_class = effective_bound_rules(
        db,
        course_classes=course_classes,
        bindings=bindings,
    )
    plan_rows = db.execute(
        select(
            CourseClass.id,
            CourseClass.class_id,
            CourseClass.course_id,
            Course.status,
            CourseUnit.id,
            CourseUnit.activity_key,
            CourseUnit.status,
            CourseUnitClassPlan.release_mode,
        )
        .join(Course, Course.id == CourseClass.course_id)
        .join(
            CourseUnitClassPlan,
            CourseUnitClassPlan.course_class_id == CourseClass.id,
        )
        .join(
            CourseUnit,
            CourseUnit.id == CourseUnitClassPlan.course_unit_id,
        )
        .where(CourseClass.id.in_({course_class.id for course_class in course_classes}))
    ).all()
    eligible_scopes: set[tuple[int, int, int, int, int]] = set()
    for (
        course_class_id,
        scope_class_id,
        scope_course_id,
        course_status,
        course_unit_id,
        activity_key,
        unit_status,
        release_mode,
    ) in plan_rows:
        course_class = course_class_by_id[int(course_class_id)]
        binding = bindings.get(course_class.id)
        if binding is None:
            continue
        rule = rules_by_course_class.get(course_class.id)
        if rule is None:
            raise HTTPException(
                status_code=409,
                detail="Completion rule binding is invalid",
            )
        if (
            rule.course_id != scope_course_id
            or rule.version_number != binding.rule_version
            or rule.status != "active"
        ):
            raise HTTPException(
                status_code=409,
                detail="Completion rule binding is invalid",
            )
        defined_activity_keys = {
            str(activity.get("activity_key"))
            for activity in rule.definition_json.get("activities", [])
            if activity.get("activity_key")
        }
        if activity_key not in defined_activity_keys:
            continue
        if (
            course_status != "published"
            or unit_status != "published"
            or release_mode == "hidden"
        ):
            continue
        eligible_scopes.add(
            (
                int(scope_class_id),
                int(scope_course_id),
                int(course_unit_id),
                binding.rule_id,
                binding.rule_version,
            )
        )
    if not eligible_scopes:
        return 0, 0
    statement = select(LearningActivityProjection).where(
        LearningActivityProjection.subject_user_id == subject_user_id,
        LearningActivityProjection.class_id.in_(selected_class_ids),
        LearningActivityProjection.rule_id.in_(
            {scope[2] for scope in rule_scopes}
        ),
    )
    projections = [
        projection
        for projection in db.scalars(statement).all()
        if (
            projection.class_id,
            projection.course_id,
            projection.course_unit_id,
            projection.rule_id,
            projection.rule_version,
        )
        in eligible_scopes
    ]
    completed = sum(
        projection.status in COMPLETED_PROJECTION_STATUSES
        for projection in projections
    )
    return len(eligible_scopes), int(completed)
