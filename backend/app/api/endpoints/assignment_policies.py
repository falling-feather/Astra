from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user
from app.db.session import get_db
from app.models import Assignment, AssignmentClassPolicy, ClassGroup, Course, CourseUnit, User
from app.schemas.course import (
    AssignmentAudienceUpdate,
    AssignmentClassPolicyRead,
    AssignmentClassPolicyUpdate,
    AssignmentPointRuleRead,
    AssignmentRead,
)
from app.services.access_control import (
    course_attached_to_class,
    lock_active_class_for_write,
    lock_active_school_for_write,
    require_course_author_or_admin,
    require_course_class_assignment_scope,
    require_school_role,
)
from app.services.assignment_policies import (
    effective_assignment_payload,
    get_assignment_class_policy,
    resolve_assignment_class_policy,
)
from app.services.audit import record_audit_log


router = APIRouter()


@router.patch("/assignments/{assignment_id}/audience", response_model=AssignmentRead)
def update_assignment_audience(
    assignment_id: int,
    payload: AssignmentAudienceUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AssignmentRead:
    assignment, _, course = _resolve_assignment(db, assignment_id)
    require_school_role(db, current_user, course.school_id, {"admin", "teacher"})
    require_course_author_or_admin(
        current_user,
        course,
        detail="Assignment audience management requires course owner role",
    )
    lock_active_school_for_write(db, course.school_id)
    if assignment.audience_mode == payload.audience_mode:
        return AssignmentRead.model_validate(assignment)

    previous_mode = assignment.audience_mode
    assignment.audience_mode = payload.audience_mode
    record_audit_log(
        db,
        actor=current_user,
        action="assignment.audience.update",
        resource_type="assignment",
        resource_id=assignment.id,
        school_id=course.school_id,
        event_result="success",
        request=request,
        snapshot={
            "before": {"audience_mode": previous_mode},
            "after": {"audience_mode": assignment.audience_mode},
        },
    )
    db.commit()
    db.refresh(assignment)
    return AssignmentRead.model_validate(assignment)


@router.get(
    "/assignments/{assignment_id}/classes/{class_id}/policy",
    response_model=AssignmentClassPolicyRead,
)
def read_assignment_class_policy(
    assignment_id: int,
    class_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AssignmentClassPolicyRead:
    assignment, _, course, class_group = _resolve_assignment_class_scope(db, assignment_id, class_id)
    require_school_role(db, current_user, course.school_id, {"admin", "teacher"})
    require_course_class_assignment_scope(
        db,
        current_user,
        course,
        class_group,
        course_roles={"editor", "assessment_editor"},
        detail="Assignment class policy requires class teacher scope",
    )
    return _policy_read(db, assignment, class_id)


@router.put(
    "/assignments/{assignment_id}/classes/{class_id}/policy",
    response_model=AssignmentClassPolicyRead,
)
def put_assignment_class_policy(
    assignment_id: int,
    class_id: int,
    payload: AssignmentClassPolicyUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AssignmentClassPolicyRead:
    assignment, _, course, class_group = _resolve_assignment_class_scope(db, assignment_id, class_id)
    require_school_role(db, current_user, course.school_id, {"admin", "teacher"})
    require_course_class_assignment_scope(
        db,
        current_user,
        course,
        class_group,
        course_roles={"editor", "assessment_editor"},
        detail="Assignment class policy requires class teacher scope",
    )
    class_group = lock_active_class_for_write(db, class_group.id)

    policy = get_assignment_class_policy(db, assignment.id, class_id)
    before = _policy_snapshot(policy)
    point_rule_json = payload.point_rule.model_dump() if payload.point_rule is not None else None
    if policy is None:
        policy = AssignmentClassPolicy(
            assignment_id=assignment.id,
            class_id=class_id,
            assigned=payload.assigned,
            status_override=payload.status_override,
            due_at_overridden=payload.due_at_overridden,
            due_at_override=payload.due_at_override if payload.due_at_overridden else None,
            point_rule_json=point_rule_json,
        )
        db.add(policy)
        db.flush()
    else:
        policy.assigned = payload.assigned
        policy.status_override = payload.status_override
        policy.due_at_overridden = payload.due_at_overridden
        policy.due_at_override = payload.due_at_override if payload.due_at_overridden else None
        policy.point_rule_json = point_rule_json
    after = _policy_snapshot(policy)
    if before != after:
        record_audit_log(
            db,
            actor=current_user,
            action="assignment.class_policy.upsert",
            resource_type="assignment_class_policy",
            resource_id=policy.id,
            school_id=course.school_id,
            class_id=class_id,
            event_result="success",
            request=request,
            snapshot={"before": before, "after": after},
        )
        db.commit()
        db.refresh(policy)
    return _policy_read(db, assignment, class_id)


@router.delete(
    "/assignments/{assignment_id}/classes/{class_id}/policy",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_assignment_class_policy(
    assignment_id: int,
    class_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    assignment, _, course, class_group = _resolve_assignment_class_scope(db, assignment_id, class_id)
    require_school_role(db, current_user, course.school_id, {"admin", "teacher"})
    require_course_class_assignment_scope(
        db,
        current_user,
        course,
        class_group,
        course_roles={"editor", "assessment_editor"},
        detail="Assignment class policy requires class teacher scope",
    )
    class_group = lock_active_class_for_write(db, class_group.id)
    policy = get_assignment_class_policy(db, assignment.id, class_id)
    if policy is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    before = _policy_snapshot(policy)
    record_audit_log(
        db,
        actor=current_user,
        action="assignment.class_policy.delete",
        resource_type="assignment_class_policy",
        resource_id=policy.id,
        school_id=course.school_id,
        class_id=class_id,
        event_result="success",
        request=request,
        snapshot={"before": before, "after": None},
    )
    db.delete(policy)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _resolve_assignment(db: Session, assignment_id: int) -> tuple[Assignment, CourseUnit, Course]:
    assignment = db.get(Assignment, assignment_id)
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found")
    unit = db.get(CourseUnit, assignment.unit_id)
    if unit is None:
        raise HTTPException(status_code=404, detail="Course unit not found")
    course = db.get(Course, unit.course_id)
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    return assignment, unit, course


def _resolve_assignment_class_scope(
    db: Session,
    assignment_id: int,
    class_id: int,
) -> tuple[Assignment, CourseUnit, Course, ClassGroup]:
    assignment, unit, course = _resolve_assignment(db, assignment_id)
    class_group = db.get(ClassGroup, class_id)
    if class_group is None:
        raise HTTPException(status_code=404, detail="Class not found")
    if class_group.school_id != course.school_id:
        raise HTTPException(status_code=422, detail="Class does not belong to assignment school")
    if not course_attached_to_class(db, course.id, class_group.id):
        raise HTTPException(status_code=403, detail="Course is not attached to this class")
    return assignment, unit, course, class_group


def _policy_read(db: Session, assignment: Assignment, class_id: int) -> AssignmentClassPolicyRead:
    effective = resolve_assignment_class_policy(db, assignment, class_id)
    policy = effective.policy
    return AssignmentClassPolicyRead(
        id=policy.id if policy is not None else None,
        persisted=policy is not None,
        assignment_id=assignment.id,
        class_id=class_id,
        assigned=effective.assigned,
        status_override=policy.status_override if policy is not None else None,
        due_at_overridden=policy.due_at_overridden if policy is not None else False,
        due_at_override=policy.due_at_override if policy is not None else None,
        point_rule=AssignmentPointRuleRead(
            assignment_id=assignment.id,
            enabled=effective.point_rule["enabled"],
            points_per_score=effective.point_rule["points_per_score"],
            max_points=effective.point_rule["max_points"],
            source=effective.point_rule_source,
        ),
        effective_assignment=AssignmentRead.model_validate(effective_assignment_payload(assignment, effective)),
    )


def _policy_snapshot(policy: AssignmentClassPolicy | None) -> dict | None:
    if policy is None:
        return None
    return {
        "id": policy.id,
        "assignment_id": policy.assignment_id,
        "class_id": policy.class_id,
        "assigned": policy.assigned,
        "status_override": policy.status_override,
        "due_at_overridden": policy.due_at_overridden,
        "due_at_override": policy.due_at_override.isoformat() if policy.due_at_override is not None else None,
        "point_rule": policy.point_rule_json,
    }
