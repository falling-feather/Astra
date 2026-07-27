from dataclasses import dataclass
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.models import Assignment, AssignmentClassPolicy
from app.services.points import normalize_assignment_point_rule


@dataclass(frozen=True)
class EffectiveAssignmentPolicy:
    assignment_id: int
    class_id: int
    assigned: bool
    status: str
    due_at: datetime | None
    point_rule: dict
    point_rule_source: str
    policy: AssignmentClassPolicy | None

    @property
    def policy_source(self) -> str:
        return "class_policy" if self.policy is not None else "base"


def get_assignment_class_policy(
    db: Session,
    assignment_id: int,
    class_id: int,
    *,
    locking_read: bool = False,
) -> AssignmentClassPolicy | None:
    return db.scalar(
        assignment_class_policy_statement(
            assignment_id,
            class_id,
            locking_read=locking_read,
        )
    )


def assignment_class_policy_statement(
    assignment_id: int,
    class_id: int,
    *,
    locking_read: bool = False,
):
    statement = select(AssignmentClassPolicy).where(
        AssignmentClassPolicy.assignment_id == assignment_id,
        AssignmentClassPolicy.class_id == class_id,
    )
    return statement.with_for_update() if locking_read else statement


def resolve_assignment_class_policy(
    db: Session,
    assignment: Assignment,
    class_id: int,
    *,
    locking_read: bool = False,
) -> EffectiveAssignmentPolicy:
    if locking_read:
        locked_assignment = db.scalar(
            select(Assignment)
            .where(Assignment.id == assignment.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if locked_assignment is None:
            raise HTTPException(
                status_code=404,
                detail="Assignment no longer exists",
            )
        assignment = locked_assignment
    policy = get_assignment_class_policy(
        db,
        assignment.id,
        class_id,
        locking_read=locking_read,
    )
    return build_effective_assignment_policy(assignment, class_id, policy)


def build_effective_assignment_policy(
    assignment: Assignment,
    class_id: int,
    policy: AssignmentClassPolicy | None,
) -> EffectiveAssignmentPolicy:
    if assignment.audience_mode == "selected_classes":
        assigned = policy is not None and policy.assigned
    else:
        assigned = policy is None or policy.assigned

    status = policy.status_override if policy is not None and policy.status_override is not None else assignment.status
    due_at = (
        policy.due_at_override
        if policy is not None and policy.due_at_overridden
        else assignment.due_at
    )
    if policy is not None and policy.point_rule_json is not None:
        point_rule_json = policy.point_rule_json
        point_rule_source = "class_override"
    else:
        point_rule_json = assignment.point_rule_json
        point_rule_source = "custom" if assignment.point_rule_json is not None else "default"
    return EffectiveAssignmentPolicy(
        assignment_id=assignment.id,
        class_id=class_id,
        assigned=assigned,
        status=status,
        due_at=due_at,
        point_rule=normalize_assignment_point_rule(point_rule_json),
        point_rule_source=point_rule_source,
        policy=policy,
    )


def effective_assignment_payload(
    assignment: Assignment,
    effective: EffectiveAssignmentPolicy | None = None,
) -> dict:
    return {
        "id": assignment.id,
        "unit_id": assignment.unit_id,
        "title": assignment.title,
        "description": assignment.description,
        "due_at": effective.due_at if effective is not None else assignment.due_at,
        "max_score": assignment.max_score,
        "status": effective.status if effective is not None else assignment.status,
        "audience_mode": assignment.audience_mode,
        "effective_class_id": effective.class_id if effective is not None else None,
        "policy_source": effective.policy_source if effective is not None else "base",
    }


def assignment_class_is_assigned_expression():
    return or_(
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


def assignment_class_effective_status_expression():
    return func.coalesce(AssignmentClassPolicy.status_override, Assignment.status)
