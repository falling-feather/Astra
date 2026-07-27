from __future__ import annotations

from contextlib import nullcontext
from datetime import UTC, datetime, timedelta
import hashlib
import json
from threading import RLock
from typing import Any

from fastapi import HTTPException, Request
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.learning_evidence_contract import (
    MAX_RULE_WITNESS_EVENTS,
    RULE_DERIVED_CLIENT_EVENT_PREFIX,
    normalize_event_occurred_at,
)
from app.models import (
    Assignment,
    ClassMembership,
    Course,
    CourseClass,
    CourseUnit,
    CourseUnitClassPlan,
    LearningActivityProjection,
    LearningCompletionRule,
    LearningEvidenceEvent,
    LearningResumeProjection,
    LearningRuleActivation,
    LearningRuleClassBinding,
    User,
)
from app.models.base import utc_now
from app.schemas.learning_evidence import (
    CompletionRuleActivate,
    CompletionRuleCreate,
    LearnerEvidenceBatchCreate,
    LearnerEvidenceEventCreate,
    TeacherEvidenceCorrectionCreate,
    TrustedAssessmentEvidenceCreate,
)
from app.models.learning_evidence import (
    CURRENT_EVENT_SCHEMA_VERSION,
    CURRENT_RULE_DEFINITION_SCHEMA_VERSION,
)
from app.services.access_control import (
    course_attached_to_class,
    get_class,
    get_course,
    lock_active_class_for_write,
    lock_course_for_write,
    require_class_member,
    require_class_teacher_or_admin,
    require_course_collaborator_or_admin,
    require_course_scope,
)
from app.services.audit import record_audit_log
from app.services.assignment_policies import resolve_assignment_class_policy
from app.services.course_release_plans import (
    effective_unit_access,
    get_plan_for_unit,
)
from app.services.course_release_write_gate import (
    lock_unit_release_scope_for_write,
    require_student_unit_open_for_write,
    require_unit_release_open_for_write,
)
from app.services.learning_evidence_access import (
    authoritative_prerequisite_unit_ids,
    authoritative_prerequisite_unit_ids_by_scope,
    effective_bound_rule,
    effective_bound_rules,
    effective_rule_binding,
    effective_rule_bindings,
    effective_rule_binding_statement,
)
from app.services.learning_evidence_projection import (
    ActivityProjectionScope,
    completion_decision,
    rebuild_activity_projection,
    rebuild_subject_course_projections,
    scope_from_event,
)


MAX_FUTURE_CLOCK_SKEW = timedelta(minutes=5)
_SQLITE_EVENT_WRITE_LOCK = RLock()
_SQLITE_RULE_ACTIVATION_LOCK = _SQLITE_EVENT_WRITE_LOCK


class LearningEvidenceError(Exception):
    def __init__(self, status_code: int, code: str, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.code = code
        self.detail = detail


def create_completion_rule(
    db: Session,
    *,
    actor: User,
    payload: CompletionRuleCreate,
    request: Request | None = None,
) -> dict:
    course = _lock_course_evidence_anchor(db, payload.course_id)
    if course.status == "archived":
        _fail(409, "course_archived", "Archived courses cannot receive completion rules")
    require_course_collaborator_or_admin(
        db,
        actor,
        course,
        {"assessment_editor"},
        detail="Completion rule creation requires course owner, assessment_editor, or admin",
        locking_read=True,
    )
    definition = {
        "schema_version": CURRENT_RULE_DEFINITION_SCHEMA_VERSION,
        "activities": [
            activity.model_dump(mode="json")
            for activity in sorted(payload.activities, key=lambda item: item.activity_key)
        ]
    }
    _validate_completion_rule_activities(
        db,
        course_id=course.id,
        definition_json=definition,
        require_published_coverage=False,
        locking_read=True,
    )
    definition_sha256 = _canonical_sha256(definition)
    latest_version = int(
        db.scalar(
            select(func.max(LearningCompletionRule.version_number)).where(
                LearningCompletionRule.course_id == course.id
            )
        )
        or 0
    )
    rule = LearningCompletionRule(
        course_id=course.id,
        version_number=latest_version + 1,
        status="draft",
        definition_json=definition,
        definition_sha256=definition_sha256,
        created_by_user_id=actor.id,
    )
    db.add(rule)
    try:
        db.flush([rule])
    except IntegrityError as exc:
        db.rollback()
        raise LearningEvidenceError(
            409,
            "rule_version_conflict",
            "Completion rule version was created concurrently; retry from current state",
        ) from exc
    record_audit_log(
        db,
        action="learning_evidence.rule.create",
        resource_type="learning_completion_rule",
        resource_id=rule.id,
        actor=actor,
        school_id=course.school_id,
        event_result="success",
        request=request,
        snapshot={
            "course_id": course.id,
            "version_number": rule.version_number,
            "definition_sha256": definition_sha256,
        },
    )
    db.commit()
    db.refresh(rule)
    return _rule_read(rule)


def list_completion_rules(
    db: Session,
    *,
    actor: User,
    course_id: int,
) -> list[dict]:
    course = get_course(db, course_id)
    require_course_collaborator_or_admin(
        db,
        actor,
        course,
        {"editor", "assessment_editor"},
        detail="Completion rules require course owner, editor, assessment_editor, or admin",
    )
    rules = list(
        db.scalars(
            select(LearningCompletionRule)
            .where(LearningCompletionRule.course_id == course.id)
            .order_by(LearningCompletionRule.version_number)
        ).all()
    )
    return [_rule_read(rule) for rule in rules]


def get_completion_rule_activation_state(
    db: Session,
    *,
    actor: User,
    course_id: int,
) -> dict:
    course = get_course(db, course_id)
    require_course_collaborator_or_admin(
        db,
        actor,
        course,
        {"editor", "assessment_editor"},
        detail=(
            "Completion rule activation state requires course owner, editor, "
            "assessment_editor, or admin"
        ),
    )
    activation = db.scalar(
        select(LearningRuleActivation).where(
            LearningRuleActivation.course_id == course.id
        )
    )
    course_classes = list(
        db.scalars(
            select(CourseClass)
            .where(
                CourseClass.course_id == course.id,
                CourseClass.status == "active",
            )
            .order_by(CourseClass.class_id, CourseClass.id)
        ).all()
    )
    bindings_by_course_class = effective_rule_bindings(db, course_classes)
    try:
        effective_bound_rules(
            db,
            course_classes=course_classes,
            bindings=bindings_by_course_class,
        )
    except HTTPException:
        _fail(
            409,
            "rule_binding_invalid",
            "Bound completion rule coordinates are invalid",
        )
    effective_bindings = [
        _effective_binding_state_read(
            course_class,
            bindings_by_course_class.get(course_class.id),
        )
        for course_class in course_classes
    ]
    if activation is None:
        return {
            "course_id": course.id,
            "revision": 0,
            "active_rule": None,
            "bindings": effective_bindings,
        }
    rule = db.get(LearningCompletionRule, activation.active_rule_id)
    if (
        rule is None
        or rule.course_id != course.id
        or rule.status != "active"
    ):
        _fail(409, "activation_rule_missing", "Active completion rule is missing")
    return {
        "course_id": course.id,
        "revision": activation.revision,
        "active_rule": _rule_read(rule),
        "bindings": effective_bindings,
    }


def activate_completion_rule(
    db: Session,
    *,
    actor: User,
    rule_id: int,
    payload: CompletionRuleActivate,
    request: Request | None = None,
) -> dict:
    write_lock = (
        _SQLITE_RULE_ACTIVATION_LOCK
        if db.get_bind().dialect.name == "sqlite"
        else nullcontext()
    )
    with write_lock:
        return _activate_completion_rule_locked(
            db,
            actor=actor,
            rule_id=rule_id,
            payload=payload,
            request=request,
        )


def _activate_completion_rule_locked(
    db: Session,
    *,
    actor: User,
    rule_id: int,
    payload: CompletionRuleActivate,
    request: Request | None = None,
) -> dict:
    rule_hint = db.get(LearningCompletionRule, rule_id)
    if rule_hint is None:
        _fail(404, "rule_not_found", "Completion rule not found")
    course = _lock_course_evidence_anchor(db, rule_hint.course_id)
    if course.status == "archived":
        _fail(409, "course_archived", "Archived courses cannot activate completion rules")
    require_course_collaborator_or_admin(
        db,
        actor,
        course,
        {"editor"},
        detail="Completion rule activation requires course edit scope",
        locking_read=True,
    )

    binding_targets: list[
        tuple[Any, CourseClass, LearningRuleClassBinding | None]
    ] = []
    for requested in sorted(payload.class_bindings, key=lambda item: item.class_id):
        lock_active_class_for_write(
            db,
            requested.class_id,
            expected_school_id=course.school_id,
        )
        course_class = db.scalar(
            select(CourseClass)
            .where(
                CourseClass.course_id == course.id,
                CourseClass.class_id == requested.class_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if course_class is None:
            _fail(403, "course_class_missing", "Course is not attached to the requested class")
        if course_class.status != "active":
            _fail(409, "course_class_inactive", "Course attachment is not active")
        if course_class.plan_version != requested.expected_plan_version:
            _fail(409, "plan_version_conflict", "Course release plan version is stale")
        existing = db.scalar(
            select(LearningRuleClassBinding)
            .where(
                LearningRuleClassBinding.course_class_id == course_class.id,
                LearningRuleClassBinding.plan_version == course_class.plan_version,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        binding_targets.append((requested, course_class, existing))

    rule = db.scalar(
        select(LearningCompletionRule)
        .where(
            LearningCompletionRule.id == rule_id,
            LearningCompletionRule.course_id == course.id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if rule is None:
        _fail(404, "rule_not_found", "Completion rule not found")
    for _requested, _course_class, existing in binding_targets:
        if existing is None:
            continue
        if existing.rule_id != rule.id:
            _fail(
                409,
                "plan_rule_already_bound",
                "This class release-plan version is already bound to another completion rule",
            )
        if existing.rule_version != rule.version_number:
            _fail(
                409,
                "rule_binding_invalid",
                "Existing class rule binding coordinates are invalid",
            )
    _validate_completion_rule_activities(
        db,
        course_id=course.id,
        definition_json=rule.definition_json,
        require_published_coverage=True,
        locking_read=True,
    )
    activation = db.scalar(
        select(LearningRuleActivation)
        .where(LearningRuleActivation.course_id == course.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    current_revision = activation.revision if activation is not None else 0
    if current_revision != payload.expected_revision:
        _fail(409, "activation_revision_conflict", "Completion rule activation revision is stale")

    bindings: list[dict] = []
    bindings_changed = False
    for requested, course_class, existing in binding_targets:
        if existing is None:
            existing = LearningRuleClassBinding(
                course_class_id=course_class.id,
                plan_version=course_class.plan_version,
                rule_id=rule.id,
                rule_version=rule.version_number,
                created_by_user_id=actor.id,
            )
            db.add(existing)
            db.flush([existing])
            bindings_changed = True
        bindings.append(_binding_read(existing, requested.class_id))

    pointer_changed = activation is None or activation.active_rule_id != rule.id
    changed = pointer_changed or bindings_changed or rule.status != "active"
    if changed:
        now = utc_now()
        if activation is None:
            activation = LearningRuleActivation(
                course_id=course.id,
                active_rule_id=rule.id,
                revision=1,
                activated_by_user_id=actor.id,
                activated_at=now,
            )
            db.add(activation)
        else:
            activation.active_rule_id = rule.id
            activation.revision += 1
            activation.activated_by_user_id = actor.id
            activation.activated_at = now
        if rule.status == "draft":
            rule.status = "active"
            rule.activated_by_user_id = actor.id
            rule.activated_at = now
        record_audit_log(
            db,
            action="learning_evidence.rule.activate",
            resource_type="learning_completion_rule",
            resource_id=rule.id,
            actor=actor,
            school_id=course.school_id,
            event_result="success",
            request=request,
            snapshot={
                "course_id": course.id,
                "rule_version": rule.version_number,
                "previous_revision": current_revision,
                "new_revision": activation.revision,
                "class_plan_bindings": [
                    {
                        "class_id": item["class_id"],
                        "plan_version": item["plan_version"],
                    }
                    for item in bindings
                ],
            },
        )
    db.commit()
    db.refresh(rule)
    db.refresh(activation)
    return {
        "course_id": course.id,
        "rule": _rule_read(rule),
        "revision": activation.revision,
        "changed": changed,
        "bindings": bindings,
    }


def append_learner_event(
    db: Session,
    *,
    actor: User,
    payload: LearnerEvidenceEventCreate,
) -> dict:
    write_lock = _SQLITE_EVENT_WRITE_LOCK if db.get_bind().dialect.name == "sqlite" else nullcontext()
    with write_lock:
        return _append_learner_event_locked(db, actor=actor, payload=payload)


def _append_learner_event_locked(
    db: Session,
    *,
    actor: User,
    payload: LearnerEvidenceEventCreate,
) -> dict:
    if actor.role != "student":
        _fail(403, "learner_role_required", "Only learners can append learner evidence facts")
    subject_user_id = actor.id
    occurred_at = _validate_occurred_at(payload.occurred_at)
    request_hash = _event_request_hash(
        actor_user_id=actor.id,
        subject_user_id=subject_user_id,
        producer_type="learner",
        payload=payload.model_dump(mode="python"),
    )
    replay = _idempotent_receipt(
        db,
        client_event_id=payload.client_event_id,
        actor_user_id=actor.id,
        subject_user_id=subject_user_id,
        request_sha256=request_hash,
    )
    if replay is not None:
        return replay
    scope = _lock_learner_scope(
        db,
        subject=actor,
        class_id=payload.class_id,
        course_id=payload.course_id,
        course_unit_id=payload.course_unit_id,
        activity_key=payload.activity_key,
        rule_version=payload.rule_version,
        assignment_id=payload.assignment_id,
    )
    event = LearningEvidenceEvent(
        client_event_id=payload.client_event_id,
        request_sha256=request_hash,
        actor_user_id=actor.id,
        subject_user_id=subject_user_id,
        producer_type="learner",
        school_id=scope["course"].school_id,
        class_id=scope["class_group"].id,
        course_id=scope["course"].id,
        course_unit_id=scope["unit"].id,
        assignment_id=scope["assignment"].id if scope["assignment"] is not None else None,
        activity_key=scope["unit"].activity_key,
        rule_id=scope["rule"].id,
        rule_version=scope["rule"].version_number,
        event_schema_version=CURRENT_EVENT_SCHEMA_VERSION,
        event_type=payload.event_type,
        evidence_json=payload.evidence,
        source_event_ids_json=[],
        occurred_at=occurred_at,
        received_at=utc_now(),
    )
    if not _insert_event_or_resolve_replay(db, event):
        replay = _idempotent_receipt(
            db,
            client_event_id=payload.client_event_id,
            actor_user_id=actor.id,
            subject_user_id=subject_user_id,
            request_sha256=request_hash,
            locking_read=True,
        )
        if replay is None:
            _fail(409, "idempotency_race", "Event idempotency race could not be resolved")
        return replay

    projection_scope = scope_from_event(event)
    decision = completion_decision(
        db,
        scope=projection_scope,
        definition_json=scope["rule"].definition_json,
        locking_read=True,
    )
    if decision is not None and not decision.already_derived:
        _append_rule_derived_event(
            db,
            actor_user_id=actor.id,
            source_event=event,
            outcome=decision.outcome,
            source_event_ids=decision.source_event_ids,
            locking_read=True,
        )
    rebuild_activity_projection(
        db,
        scope=projection_scope,
        definition_json=scope["rule"].definition_json,
        locking_read=True,
    )
    db.commit()
    db.refresh(event)
    return _receipt(event, "accepted")


def append_learner_event_batch(
    db: Session,
    *,
    actor: User,
    payload: LearnerEvidenceBatchCreate,
) -> dict:
    results: list[dict] = []
    counts = {"accepted": 0, "duplicate": 0, "rejected": 0, "conflict": 0}
    for item in payload.items:
        try:
            receipt = append_learner_event(db, actor=actor, payload=item)
            outcome = receipt["outcome"]
            counts[outcome] += 1
            results.append(
                {
                    "client_event_id": item.client_event_id,
                    "outcome": outcome,
                    "receipt": receipt,
                    "status_code": 201 if outcome == "accepted" else 200,
                    "error_code": None,
                    "detail": None,
                }
            )
        except LearningEvidenceError as exc:
            db.rollback()
            outcome = "conflict" if exc.status_code == 409 else "rejected"
            counts[outcome] += 1
            results.append(
                {
                    "client_event_id": item.client_event_id,
                    "outcome": outcome,
                    "receipt": None,
                    "status_code": exc.status_code,
                    "error_code": exc.code,
                    "detail": exc.detail,
                }
            )
        except HTTPException as exc:
            db.rollback()
            outcome = "conflict" if exc.status_code == 409 else "rejected"
            counts[outcome] += 1
            results.append(
                {
                    "client_event_id": item.client_event_id,
                    "outcome": outcome,
                    "receipt": None,
                    "status_code": exc.status_code,
                    "error_code": "scope_rejected",
                    "detail": str(exc.detail),
                }
            )
    return {
        "items": results,
        "accepted_count": counts["accepted"],
        "duplicate_count": counts["duplicate"],
        "rejected_count": counts["rejected"],
        "conflict_count": counts["conflict"],
    }


def append_teacher_correction(
    db: Session,
    *,
    actor: User,
    target_event_id: int,
    payload: TeacherEvidenceCorrectionCreate,
    request: Request | None = None,
) -> dict:
    write_lock = _SQLITE_EVENT_WRITE_LOCK if db.get_bind().dialect.name == "sqlite" else nullcontext()
    with write_lock:
        return _append_teacher_correction_locked(
            db,
            actor=actor,
            target_event_id=target_event_id,
            payload=payload,
            request=request,
        )


def _append_teacher_correction_locked(
    db: Session,
    *,
    actor: User,
    target_event_id: int,
    payload: TeacherEvidenceCorrectionCreate,
    request: Request | None = None,
) -> dict:
    occurred_at = _validate_occurred_at(payload.occurred_at)
    request_hash = _event_request_hash(
        actor_user_id=actor.id,
        subject_user_id=None,
        producer_type="teacher_correction",
        payload={
            "target_event_id": target_event_id,
            **payload.model_dump(mode="python"),
        },
    )
    target_hint = db.get(LearningEvidenceEvent, target_event_id)
    if target_hint is None:
        _fail(404, "target_event_not_found", "Learning evidence event not found")
    locked_course = _lock_course_evidence_anchor(db, target_hint.course_id)
    class_group = lock_active_class_for_write(
        db,
        target_hint.class_id,
        expected_school_id=locked_course.school_id,
    )
    require_class_teacher_or_admin(
        db,
        actor,
        class_group,
        detail="Learning evidence correction requires class teacher scope",
        locking_read=True,
    )
    replay = _idempotent_receipt(
        db,
        client_event_id=payload.client_event_id,
        actor_user_id=actor.id,
        subject_user_id=target_hint.subject_user_id,
        request_sha256=request_hash,
    )
    if replay is not None:
        return replay
    release_scope = lock_unit_release_scope_for_write(
        db,
        course=locked_course,
        class_group=class_group,
        unit_id=target_hint.course_unit_id,
    )
    rule = db.scalar(
        select(LearningCompletionRule)
        .where(
            LearningCompletionRule.id == target_hint.rule_id,
            LearningCompletionRule.course_id == target_hint.course_id,
            LearningCompletionRule.version_number == target_hint.rule_version,
            LearningCompletionRule.status == "active",
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if rule is None:
        _fail(
            409,
            "rule_binding_invalid",
            "Completion rule referenced by event is invalid",
        )
    replay = _idempotent_receipt(
        db,
        client_event_id=payload.client_event_id,
        actor_user_id=actor.id,
        subject_user_id=target_hint.subject_user_id,
        request_sha256=request_hash,
        locking_read=True,
    )
    if replay is not None:
        return replay
    require_unit_release_open_for_write(
        db,
        course=locked_course,
        class_group=class_group,
        scope=release_scope,
        subject_user_id=target_hint.subject_user_id,
    )
    target = db.scalar(
        select(LearningEvidenceEvent)
        .where(LearningEvidenceEvent.id == target_event_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if target is None:
        _fail(404, "target_event_not_found", "Learning evidence event not found")
    if (
        target.course_id != locked_course.id
        or target.class_id != class_group.id
        or target.course_unit_id != release_scope.unit.id
        or target.rule_id != rule.id
        or target.rule_version != rule.version_number
    ):
        _fail(
            409,
            "correction_target_scope_changed",
            "Correction target no longer matches its locked evidence scope",
        )
    if target.producer_type == "rule":
        _fail(
            409,
            "correction_target_derived",
            "Rule-derived outcomes are determined by source facts and cannot be corrected directly",
        )
    if target.producer_type not in {"learner", "trusted_assessment"}:
        _fail(
            409,
            "correction_target_invalid",
            "Administrative corrections can target learner or trusted assessment facts only",
        )
    prior_correction = _correction_for_target_id(
        db,
        target.id,
        locking_read=True,
    )
    if prior_correction is not None:
        _fail(409, "event_already_corrected", "Learning evidence event already has an administrative correction")
    correction = LearningEvidenceEvent(
        client_event_id=payload.client_event_id,
        request_sha256=request_hash,
        actor_user_id=actor.id,
        subject_user_id=target.subject_user_id,
        producer_type="teacher_correction",
        school_id=target.school_id,
        class_id=target.class_id,
        course_id=target.course_id,
        course_unit_id=target.course_unit_id,
        assignment_id=target.assignment_id,
        activity_key=target.activity_key,
        rule_id=target.rule_id,
        rule_version=target.rule_version,
        event_schema_version=CURRENT_EVENT_SCHEMA_VERSION,
        event_type="administrative_correction",
        evidence_json={"action": "invalidate", "reason": payload.reason.strip()},
        source_event_ids_json=[target.id],
        corrects_event_id=target.id,
        occurred_at=occurred_at,
        received_at=utc_now(),
    )
    if not _insert_event_or_resolve_replay(db, correction):
        replay = _idempotent_receipt(
            db,
            client_event_id=payload.client_event_id,
            actor_user_id=actor.id,
            subject_user_id=target.subject_user_id,
            request_sha256=request_hash,
            locking_read=True,
        )
        if replay is not None:
            return replay
        if _correction_for_target_id(db, target.id, locking_read=True) is not None:
            _fail(409, "event_already_corrected", "Learning evidence event already has an administrative correction")
        _fail(409, "idempotency_race", "Correction idempotency race could not be resolved")
    if target.producer_type == "learner":
        decision = completion_decision(
            db,
            scope=scope_from_event(target),
            definition_json=rule.definition_json,
            locking_read=True,
        )
        if decision is not None and not decision.already_derived:
            witness_event = db.get(
                LearningEvidenceEvent,
                decision.source_event_ids[-1],
            )
            _append_rule_derived_event(
                db,
                actor_user_id=actor.id,
                source_event=witness_event or target,
                outcome=decision.outcome,
                source_event_ids=decision.source_event_ids,
                locking_read=True,
            )
    rebuild_activity_projection(
        db,
        scope=scope_from_event(target),
        definition_json=rule.definition_json,
        locking_read=True,
    )
    record_audit_log(
        db,
        action="learning_evidence.event.correct",
        resource_type="learning_evidence_event",
        resource_id=target.id,
        actor=actor,
        school_id=target.school_id,
        class_id=target.class_id,
        event_result="success",
        request=request,
        snapshot={
            "correction_event_id": correction.id,
            "subject_user_id": target.subject_user_id,
            "event_type": target.event_type,
            "reason": payload.reason.strip(),
        },
    )
    db.commit()
    db.refresh(correction)
    return _receipt(correction, "accepted")


def append_trusted_assessment_result(
    db: Session,
    *,
    actor: User,
    subject_user_id: int,
    client_event_id: str,
    class_id: int,
    course_id: int,
    course_unit_id: int,
    activity_key: str,
    rule_version: int,
    outcome: str,
    source_ref: str,
    occurred_at: datetime,
    evidence: dict[str, Any] | None = None,
) -> dict:
    write_lock = _SQLITE_EVENT_WRITE_LOCK if db.get_bind().dialect.name == "sqlite" else nullcontext()
    with write_lock:
        return _append_trusted_assessment_result_locked(
            db,
            actor=actor,
            subject_user_id=subject_user_id,
            client_event_id=client_event_id,
            class_id=class_id,
            course_id=course_id,
            course_unit_id=course_unit_id,
            activity_key=activity_key,
            rule_version=rule_version,
            outcome=outcome,
            source_ref=source_ref,
            occurred_at=occurred_at,
            evidence=evidence,
        )


def _append_trusted_assessment_result_locked(
    db: Session,
    *,
    actor: User,
    subject_user_id: int,
    client_event_id: str,
    class_id: int,
    course_id: int,
    course_unit_id: int,
    activity_key: str,
    rule_version: int,
    outcome: str,
    source_ref: str,
    occurred_at: datetime,
    evidence: dict[str, Any] | None = None,
) -> dict:
    try:
        command = TrustedAssessmentEvidenceCreate.model_validate(
            {
                "client_event_id": client_event_id,
                "subject_user_id": subject_user_id,
                "class_id": class_id,
                "course_id": course_id,
                "course_unit_id": course_unit_id,
                "activity_key": activity_key,
                "rule_version": rule_version,
                "outcome": outcome,
                "source_ref": source_ref,
                "occurred_at": occurred_at,
                "evidence": evidence if evidence is not None else {},
            }
        )
    except ValidationError as exc:
        first_error = exc.errors(include_url=False)[0]
        _fail(
            422,
            "trusted_evidence_invalid",
            str(first_error.get("msg") or "Trusted assessment evidence is invalid"),
        )
    client_event_id = command.client_event_id
    subject_user_id = command.subject_user_id
    class_id = command.class_id
    course_id = command.course_id
    course_unit_id = command.course_unit_id
    activity_key = command.activity_key
    rule_version = command.rule_version
    outcome = command.outcome
    source_ref = command.source_ref
    occurred_at = _validate_occurred_at(command.occurred_at)
    evidence = command.evidence
    subject = db.get(User, subject_user_id)
    if subject is None or subject.role != "student" or subject.status != "active":
        _fail(404, "subject_not_found", "Active learner subject not found")
    locked_course = _lock_course_evidence_anchor(db, course_id)
    class_group = lock_active_class_for_write(
        db,
        class_id,
        expected_school_id=locked_course.school_id,
    )
    require_class_teacher_or_admin(
        db,
        actor,
        class_group,
        detail="Trusted assessment evidence requires class teacher scope",
        locking_read=True,
    )
    payload = {
        "client_event_id": client_event_id,
        "class_id": class_id,
        "course_id": course_id,
        "course_unit_id": course_unit_id,
        "activity_key": activity_key,
        "rule_version": rule_version,
        "outcome": outcome,
        "source_ref": source_ref,
        "occurred_at": occurred_at,
        "evidence": evidence,
    }
    request_hash = _event_request_hash(
        actor_user_id=actor.id,
        subject_user_id=subject.id,
        producer_type="trusted_assessment",
        payload=payload,
    )
    replay = _idempotent_receipt(
        db,
        client_event_id=client_event_id,
        actor_user_id=actor.id,
        subject_user_id=subject.id,
        request_sha256=request_hash,
    )
    if replay is not None:
        return replay
    scope = _lock_learner_scope(
        db,
        subject=subject,
        class_id=class_id,
        course_id=course_id,
        course_unit_id=course_unit_id,
        activity_key=activity_key,
        rule_version=rule_version,
        assignment_id=None,
    )
    activity_rule = next(
        (
            item
            for item in scope["rule"].definition_json.get("activities", [])
            if item.get("activity_key") == scope["unit"].activity_key
        ),
        None,
    )
    if activity_rule is None or activity_rule.get("outcome") != outcome:
        _fail(
            422,
            "trusted_outcome_mismatch",
            "Trusted assessment outcome does not match the bound activity rule",
        )
    event = LearningEvidenceEvent(
        client_event_id=client_event_id,
        request_sha256=request_hash,
        actor_user_id=actor.id,
        subject_user_id=subject.id,
        producer_type="trusted_assessment",
        school_id=scope["course"].school_id,
        class_id=class_id,
        course_id=course_id,
        course_unit_id=course_unit_id,
        assignment_id=None,
        activity_key=scope["unit"].activity_key,
        rule_id=scope["rule"].id,
        rule_version=rule_version,
        event_schema_version=CURRENT_EVENT_SCHEMA_VERSION,
        event_type=outcome,
        evidence_json={**evidence, "source_ref": source_ref},
        source_event_ids_json=[],
        occurred_at=occurred_at,
        received_at=utc_now(),
    )
    if not _insert_event_or_resolve_replay(db, event):
        replay = _idempotent_receipt(
            db,
            client_event_id=client_event_id,
            actor_user_id=actor.id,
            subject_user_id=subject.id,
            request_sha256=request_hash,
            locking_read=True,
        )
        if replay is None:
            _fail(409, "idempotency_race", "Trusted assessment idempotency race could not be resolved")
        return replay
    rebuild_activity_projection(
        db,
        scope=scope_from_event(event),
        definition_json=scope["rule"].definition_json,
        locking_read=True,
    )
    db.commit()
    db.refresh(event)
    return _receipt(event, "accepted")


def student_learning_recovery(
    db: Session,
    *,
    actor: User,
    class_id: int,
    course_id: int,
) -> dict:
    if actor.role != "student":
        _fail(403, "learner_role_required", "Student recovery requires learner role")
    class_group = require_class_member(db, actor, class_id)
    course = require_course_scope(db, actor, class_group, course_id)
    course_class, binding, rule = _current_binding(db, class_id=class_id, course_id=course_id)
    completed_ids = authoritative_prerequisite_unit_ids(
        db,
        subject_user_id=actor.id,
        class_id=class_id,
        course_id=course_id,
    )
    projections = list(
        db.scalars(
            select(LearningActivityProjection)
            .where(
                LearningActivityProjection.subject_user_id == actor.id,
                LearningActivityProjection.class_id == class_id,
                LearningActivityProjection.course_id == course_id,
                LearningActivityProjection.rule_id == rule.id,
            )
            .order_by(LearningActivityProjection.course_unit_id)
        ).all()
    )
    visible: list[dict] = []
    resumable_activity_keys: set[str] = set()
    for projection in projections:
        unit = db.get(CourseUnit, projection.course_unit_id)
        if unit is None:
            continue
        plan = get_plan_for_unit(db, course_class, unit.id)
        access = effective_unit_access(
            db,
            course=course,
            class_group=class_group,
            unit=unit,
            plan=plan,
            student_id=actor.id,
            completed_unit_ids=completed_ids,
        )
        if access.state == "hidden":
            continue
        if access.state == "open":
            resumable_activity_keys.add(projection.activity_key)
        projection_read = _projection_read(projection)
        if access.state != "open":
            projection_read["resume_cursor"] = {}
        visible.append(projection_read)
    resume = db.scalar(
        select(LearningResumeProjection).where(
            LearningResumeProjection.subject_user_id == actor.id,
            LearningResumeProjection.class_id == class_id,
            LearningResumeProjection.course_id == course_id,
            LearningResumeProjection.rule_id == rule.id,
        )
    )
    resume_read = (
        {
            "course_unit_id": resume.course_unit_id,
            "activity_key": resume.activity_key,
            "rule_version": resume.rule_version,
            "last_event_id": resume.last_event_id,
            "last_occurred_at": _as_utc(resume.last_occurred_at),
            "cursor": dict(resume.cursor_json or {}),
        }
        if resume is not None and resume.activity_key in resumable_activity_keys
        else None
    )
    return {
        "subject_user_id": actor.id,
        "class_id": class_id,
        "course_id": course_id,
        "rule_version": binding.rule_version,
        "resume": resume_read,
        "activities": visible,
    }


def teacher_learning_aggregate(
    db: Session,
    *,
    actor: User,
    class_id: int,
    course_id: int,
) -> dict:
    class_group = get_class(db, class_id)
    require_class_teacher_or_admin(
        db,
        actor,
        class_group,
        detail="Learning evidence aggregate requires class teacher scope",
    )
    if not course_attached_to_class(db, course_id, class_id):
        _fail(403, "course_class_missing", "Course is not attached to this class")
    course_class, binding, rule = _current_binding(db, class_id=class_id, course_id=course_id)
    student_ids = list(
        db.scalars(
            select(ClassMembership.user_id)
            .join(User, User.id == ClassMembership.user_id)
            .where(
                ClassMembership.class_id == class_id,
                ClassMembership.role == "student",
                ClassMembership.status == "active",
                User.role == "student",
                User.status == "active",
            )
        ).all()
    )
    plan_rows = list(
        db.execute(
            select(CourseUnitClassPlan, CourseUnit)
            .join(CourseUnit, CourseUnit.id == CourseUnitClassPlan.course_unit_id)
            .where(
                CourseUnitClassPlan.course_class_id == course_class.id,
                CourseUnit.activity_key.in_(
                    {
                        str(activity["activity_key"])
                        for activity in rule.definition_json.get("activities", [])
                    }
                ),
            )
            .order_by(CourseUnitClassPlan.position, CourseUnit.id)
        ).all()
    )
    projections = list(
        db.scalars(
            select(LearningActivityProjection).where(
                LearningActivityProjection.class_id == class_id,
                LearningActivityProjection.course_id == course_id,
                LearningActivityProjection.rule_id == rule.id,
                LearningActivityProjection.subject_user_id.in_(student_ids or [-1]),
            )
        ).all()
    )
    status_by_unit: dict[int, dict[str, int]] = {}
    for projection in projections:
        counts = status_by_unit.setdefault(projection.course_unit_id, {})
        counts[projection.status] = counts.get(projection.status, 0) + 1
    active_students = len(student_ids)
    activities: list[dict] = []
    for _plan, unit in plan_rows:
        counts = status_by_unit.get(unit.id, {})
        completed = counts.get("completed", 0)
        transferred = counts.get("transferred", 0)
        observed = sum(counts.values())
        activities.append(
            {
                "course_unit_id": unit.id,
                "activity_key": unit.activity_key,
                "not_started": max(0, active_students - observed) + counts.get("not_started", 0),
                "in_progress": counts.get("in_progress", 0),
                "completed": completed,
                "transferred": transferred,
                "active_students": active_students,
                "completion_percent": (
                    round(((completed + transferred) / active_students) * 100, 2)
                    if active_students
                    else 0.0
                ),
            }
        )
    return {
        "class_id": class_id,
        "course_id": course_id,
        "rule_version": binding.rule_version,
        "active_students": active_students,
        "generated_at": utc_now(),
        "activities": activities,
    }


def rebuild_learning_projections(
    db: Session,
    *,
    actor: User,
    class_id: int,
    course_id: int,
    subject_user_id: int | None,
) -> dict:
    write_lock = (
        _SQLITE_EVENT_WRITE_LOCK
        if db.get_bind().dialect.name == "sqlite"
        else nullcontext()
    )
    with write_lock:
        return _rebuild_learning_projections_locked(
            db,
            actor=actor,
            class_id=class_id,
            course_id=course_id,
            subject_user_id=subject_user_id,
        )


def _rebuild_learning_projections_locked(
    db: Session,
    *,
    actor: User,
    class_id: int,
    course_id: int,
    subject_user_id: int | None,
) -> dict:
    locked_course = _lock_course_evidence_anchor(db, course_id)
    class_group = lock_active_class_for_write(
        db,
        class_id,
        expected_school_id=locked_course.school_id,
    )
    require_class_teacher_or_admin(
        db,
        actor,
        class_group,
        detail="Learning projection rebuild requires class teacher scope",
        locking_read=True,
    )
    course_class = db.scalar(
        select(CourseClass)
        .where(
            CourseClass.course_id == course_id,
            CourseClass.class_id == class_id,
            CourseClass.status == "active",
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if course_class is None:
        _fail(403, "course_class_missing", "Course is not attached to this class")
    definitions = {
        rule.id: dict(rule.definition_json)
        for rule in db.scalars(
            select(LearningCompletionRule)
            .where(LearningCompletionRule.course_id == course_id)
            .with_for_update()
        ).all()
    }
    if subject_user_id is None:
        subject_ids = list(
            db.scalars(
                select(ClassMembership.user_id)
                .join(User, User.id == ClassMembership.user_id)
                .where(
                    ClassMembership.class_id == class_id,
                    ClassMembership.role == "student",
                    ClassMembership.status == "active",
                    User.role == "student",
                    User.status == "active",
                )
                .with_for_update()
            ).all()
        )
    else:
        membership = db.scalar(
            select(ClassMembership.id)
            .where(
                ClassMembership.class_id == class_id,
                ClassMembership.user_id == subject_user_id,
                ClassMembership.role == "student",
                ClassMembership.status == "active",
            )
            .with_for_update()
        )
        if membership is None:
            _fail(404, "subject_not_found", "Active learner subject not found in class")
        subject_ids = [subject_user_id]
    rebuilt_activities = 0
    rebuilt_resume = 0
    for current_subject_id in subject_ids:
        activity_count, resume_count = rebuild_subject_course_projections(
            db,
            subject_user_id=current_subject_id,
            class_id=class_id,
            course_id=course_id,
            definitions_by_rule_id=definitions,
            locking_read=True,
        )
        rebuilt_activities += activity_count
        rebuilt_resume += resume_count
    db.commit()
    return {
        "class_id": class_id,
        "course_id": course_id,
        "subject_user_id": subject_user_id,
        "rebuilt_activities": rebuilt_activities,
        "rebuilt_resume_projections": rebuilt_resume,
    }


def _lock_learner_scope(
    db: Session,
    *,
    subject: User,
    class_id: int,
    course_id: int,
    course_unit_id: int,
    activity_key: str,
    rule_version: int,
    assignment_id: int | None,
) -> dict:
    course = _lock_course_evidence_anchor(db, course_id)
    class_group = get_class(db, class_id)
    if class_group.school_id != course.school_id:
        _fail(422, "scope_mismatch", "Class does not belong to course school")
    unit = db.get(CourseUnit, course_unit_id)
    if unit is None or unit.course_id != course.id:
        _fail(404, "course_unit_not_found", "Course unit not found")
    if unit.activity_key != activity_key:
        _fail(422, "activity_key_mismatch", "activity_key does not match course unit")
    assignment = None
    if assignment_id is not None:
        assignment = db.get(Assignment, assignment_id)
        if assignment is None or assignment.unit_id != unit.id:
            _fail(404, "assignment_not_found", "Assignment not found in course unit")
    locked_class = require_student_unit_open_for_write(
        db,
        course=course,
        class_group=class_group,
        unit=unit,
        student_id=subject.id,
    )
    course_class = db.scalar(
        select(CourseClass)
        .where(
            CourseClass.course_id == course.id,
            CourseClass.class_id == locked_class.id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if course_class is None or course_class.status != "active":
        _fail(409, "course_class_inactive", "Course attachment is not active")
    if assignment is not None:
        effective_assignment = resolve_assignment_class_policy(
            db,
            assignment,
            locked_class.id,
            locking_read=True,
        )
        if assignment.unit_id != unit.id:
            _fail(
                409,
                "assignment_scope_changed",
                "Assignment moved outside the course unit during write",
            )
        if not effective_assignment.assigned:
            _fail(
                403,
                "assignment_not_assigned",
                "Assignment is not assigned to this class",
            )
        if effective_assignment.status != "active":
            _fail(
                409,
                "assignment_inactive",
                "Assignment is not active for this class",
            )
    binding = _effective_binding(db, course_class, locking_read=True)
    if binding is None:
        _fail(409, "rule_binding_missing", "Current class release plan has no completion rule binding")
    if binding.rule_version != rule_version:
        _fail(409, "rule_version_conflict", "Completion rule version is stale")
    rule = db.scalar(
        _bound_rule_statement(
            binding,
            course_id=course.id,
            locking_read=True,
        )
    )
    if rule is None or rule.status != "active":
        _fail(409, "rule_inactive", "Bound completion rule is not active")
    if not any(
        item.get("activity_key") == unit.activity_key
        for item in rule.definition_json.get("activities", [])
    ):
        _fail(422, "activity_rule_missing", "Completion rule does not define this activity")
    return {
        "class_group": locked_class,
        "course": course,
        "unit": unit,
        "assignment": assignment,
        "course_class": course_class,
        "binding": binding,
        "rule": rule,
    }


def _current_binding(
    db: Session,
    *,
    class_id: int,
    course_id: int,
) -> tuple[CourseClass, LearningRuleClassBinding, LearningCompletionRule]:
    course_class = db.scalar(
        select(CourseClass).where(
            CourseClass.class_id == class_id,
            CourseClass.course_id == course_id,
            CourseClass.status == "active",
        )
    )
    if course_class is None:
        _fail(403, "course_class_missing", "Course is not attached to this class")
    binding = _effective_binding(db, course_class)
    if binding is None:
        _fail(409, "rule_binding_missing", "Current class release plan has no completion rule binding")
    try:
        rule = effective_bound_rule(
            db,
            course_class=course_class,
            binding=binding,
        )
    except HTTPException:
        _fail(
            409,
            "rule_binding_invalid",
            "Bound completion rule coordinates are invalid",
        )
    return course_class, binding, rule


def _effective_binding(
    db: Session,
    course_class: CourseClass,
    *,
    locking_read: bool = False,
) -> LearningRuleClassBinding | None:
    """Resolve the immutable rule pin effective for a monotonic plan version.

    A release-only plan edit inherits the latest prior binding. Activating a
    rule at a newer plan version appends a new binding and becomes effective
    without rewriting any historical plan/rule association.
    """
    return effective_rule_binding(
        db,
        course_class,
        locking_read=locking_read,
    )


def _effective_binding_statement(
    course_class_id: int,
    plan_version: int,
    *,
    locking_read: bool = False,
):
    return effective_rule_binding_statement(
        course_class_id,
        plan_version,
        locking_read=locking_read,
    )


def _bound_rule_statement(
    binding: LearningRuleClassBinding,
    *,
    course_id: int,
    locking_read: bool = False,
):
    statement = select(LearningCompletionRule).where(
        LearningCompletionRule.id == binding.rule_id,
        LearningCompletionRule.course_id == course_id,
        LearningCompletionRule.version_number == binding.rule_version,
    )
    if locking_read:
        statement = statement.with_for_update()
    return statement.execution_options(populate_existing=True)


def _validate_completion_rule_activities(
    db: Session,
    *,
    course_id: int,
    definition_json: dict,
    require_published_coverage: bool,
    locking_read: bool = False,
) -> None:
    statement = select(CourseUnit.activity_key, CourseUnit.status).where(
        CourseUnit.course_id == course_id
    )
    if locking_read:
        statement = statement.with_for_update()
    units = list(
        db.execute(
            statement.execution_options(populate_existing=True)
        ).all()
    )
    course_activity_keys = {activity_key for activity_key, _status in units}
    rule_activity_keys = {
        str(activity.get("activity_key"))
        for activity in definition_json.get("activities", [])
        if activity.get("activity_key")
    }
    unknown = sorted(rule_activity_keys - course_activity_keys)
    if unknown:
        _fail(
            422,
            "activity_rule_unknown",
            f"Completion rule contains activities outside this course: {', '.join(unknown[:5])}",
        )
    if not require_published_coverage:
        return
    published_activity_keys = {
        activity_key for activity_key, status in units if status == "published"
    }
    missing = sorted(published_activity_keys - rule_activity_keys)
    if missing:
        _fail(
            422,
            "activity_rule_coverage_missing",
            f"Completion rule is missing published course activities: {', '.join(missing[:5])}",
        )
    extra = sorted(rule_activity_keys - published_activity_keys)
    if extra:
        _fail(
            422,
            "activity_rule_scope_extra",
            (
                "Completion rule contains activities that are not currently "
                f"published: {', '.join(extra[:5])}"
            ),
        )


def _append_rule_derived_event(
    db: Session,
    *,
    actor_user_id: int,
    source_event: LearningEvidenceEvent,
    outcome: str,
    source_event_ids: tuple[int, ...],
    locking_read: bool = False,
) -> LearningEvidenceEvent:
    if not source_event_ids or len(source_event_ids) > MAX_RULE_WITNESS_EVENTS:
        _fail(
            409,
            "completion_witness_invalid",
            "Rule-derived evidence requires a non-empty bounded source witness",
        )
    source_token = ",".join(str(event_id) for event_id in source_event_ids)
    client_event_id = (
        f"{RULE_DERIVED_CLIENT_EVENT_PREFIX}{source_event.rule_id}:"
        f"{source_event.subject_user_id}:"
        f"{source_event.course_unit_id}:{outcome}:"
        f"{hashlib.sha256(source_token.encode('utf-8')).hexdigest()[:32]}"
    )
    request_payload = {
        "rule_id": source_event.rule_id,
        "rule_version": source_event.rule_version,
        "subject_user_id": source_event.subject_user_id,
        "course_unit_id": source_event.course_unit_id,
        "outcome": outcome,
        "source_event_ids": list(source_event_ids),
    }
    request_sha256 = _canonical_sha256(request_payload)
    existing_statement = select(LearningEvidenceEvent).where(
        LearningEvidenceEvent.client_event_id == client_event_id
    )
    if locking_read:
        existing_statement = existing_statement.with_for_update()
    existing = db.scalar(existing_statement)
    if existing is not None:
        if not _matching_rule_derived_event(
            existing,
            source_event=source_event,
            outcome=outcome,
            source_event_ids=source_event_ids,
            request_sha256=request_sha256,
        ):
            _fail(
                409,
                "derived_event_key_collision",
                "Reserved rule-derived event key is occupied by inconsistent evidence",
            )
        return existing
    derived = LearningEvidenceEvent(
        client_event_id=client_event_id,
        request_sha256=request_sha256,
        actor_user_id=actor_user_id,
        subject_user_id=source_event.subject_user_id,
        producer_type="rule",
        school_id=source_event.school_id,
        class_id=source_event.class_id,
        course_id=source_event.course_id,
        course_unit_id=source_event.course_unit_id,
        assignment_id=source_event.assignment_id,
        activity_key=source_event.activity_key,
        rule_id=source_event.rule_id,
        rule_version=source_event.rule_version,
        event_schema_version=CURRENT_EVENT_SCHEMA_VERSION,
        event_type=outcome,
        evidence_json={
            "rule_definition_sha256": db.scalar(
                select(LearningCompletionRule.definition_sha256).where(
                    LearningCompletionRule.id == source_event.rule_id
                )
            )
        },
        source_event_ids_json=list(source_event_ids),
        occurred_at=utc_now(),
        received_at=utc_now(),
    )
    db.add(derived)
    db.flush([derived])
    return derived


def _matching_rule_derived_event(
    existing: LearningEvidenceEvent,
    *,
    source_event: LearningEvidenceEvent,
    outcome: str,
    source_event_ids: tuple[int, ...],
    request_sha256: str,
) -> bool:
    return (
        existing.producer_type == "rule"
        and existing.request_sha256 == request_sha256
        and existing.subject_user_id == source_event.subject_user_id
        and existing.school_id == source_event.school_id
        and existing.class_id == source_event.class_id
        and existing.course_id == source_event.course_id
        and existing.course_unit_id == source_event.course_unit_id
        and existing.assignment_id == source_event.assignment_id
        and existing.activity_key == source_event.activity_key
        and existing.rule_id == source_event.rule_id
        and existing.rule_version == source_event.rule_version
        and existing.event_schema_version == CURRENT_EVENT_SCHEMA_VERSION
        and existing.event_type == outcome
        and list(existing.source_event_ids_json or []) == list(source_event_ids)
        and existing.corrects_event_id is None
    )


def _insert_event_or_resolve_replay(db: Session, event: LearningEvidenceEvent) -> bool:
    try:
        with db.begin_nested():
            db.add(event)
            db.flush([event])
        return True
    except IntegrityError:
        if event in db:
            db.expunge(event)
        return False


def _lock_course_evidence_anchor(db: Session, course_id: int) -> Course:
    try:
        return lock_course_for_write(db, course_id)
    except HTTPException as exc:
        code = (
            "course_not_found"
            if exc.status_code == 404
            else "course_write_scope_unavailable"
        )
        _fail(exc.status_code, code, str(exc.detail))


def _idempotent_receipt(
    db: Session,
    *,
    client_event_id: str,
    actor_user_id: int,
    subject_user_id: int,
    request_sha256: str,
    locking_read: bool = False,
) -> dict | None:
    statement = select(LearningEvidenceEvent).where(
        LearningEvidenceEvent.client_event_id == client_event_id
    )
    if locking_read:
        statement = statement.with_for_update()
    existing = db.scalar(statement)
    if existing is None:
        return None
    if existing.actor_user_id != actor_user_id or existing.subject_user_id != subject_user_id:
        _fail(403, "idempotency_scope_mismatch", "client_event_id belongs to another actor or subject")
    if existing.request_sha256 != request_sha256:
        _fail(409, "idempotency_payload_conflict", "client_event_id was used with another payload")
    return _receipt(existing, "duplicate")


def _correction_for_target_id(
    db: Session,
    target_event_id: int,
    *,
    locking_read: bool = False,
) -> int | None:
    statement = select(LearningEvidenceEvent.id).where(
        LearningEvidenceEvent.corrects_event_id == target_event_id,
        LearningEvidenceEvent.event_type == "administrative_correction",
    )
    if locking_read:
        statement = statement.with_for_update()
    return db.scalar(statement)


def _event_request_hash(
    *,
    actor_user_id: int,
    subject_user_id: int | None,
    producer_type: str,
    payload: dict,
) -> str:
    return _canonical_sha256(
        {
            "actor_user_id": actor_user_id,
            "subject_user_id": subject_user_id,
            "producer_type": producer_type,
            "payload": payload,
        }
    )


def _canonical_sha256(value: Any) -> str:
    serialized = json.dumps(
        _canonical_value(value),
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _canonical_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return _as_utc(value).isoformat(timespec="microseconds")
    if isinstance(value, dict):
        return {str(key): _canonical_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_canonical_value(item) for item in value]
    return value


def _validate_occurred_at(value: datetime) -> datetime:
    try:
        normalized = normalize_event_occurred_at(value)
    except ValueError as exc:
        _fail(422, "occurred_at_out_of_range", str(exc))
    if normalized > utc_now() + MAX_FUTURE_CLOCK_SKEW:
        _fail(422, "occurred_at_in_future", "occurred_at exceeds allowed clock skew")
    return normalized


def _receipt(event: LearningEvidenceEvent, outcome: str) -> dict:
    return {
        "event_id": event.id,
        "client_event_id": event.client_event_id,
        "event_type": event.event_type,
        "outcome": outcome,
        "received_at": _as_utc(event.received_at),
    }


def _rule_read(rule: LearningCompletionRule) -> dict:
    return {
        "id": rule.id,
        "course_id": rule.course_id,
        "version_number": rule.version_number,
        "status": rule.status,
        "schema_version": int(rule.definition_json["schema_version"]),
        "activities": list(rule.definition_json.get("activities", [])),
        "definition_sha256": rule.definition_sha256,
        "created_by_user_id": rule.created_by_user_id,
        "activated_by_user_id": rule.activated_by_user_id,
        "activated_at": _optional_as_utc(rule.activated_at),
        "created_at": _as_utc(rule.created_at),
    }


def _binding_read(binding: LearningRuleClassBinding, class_id: int) -> dict:
    return {
        "class_id": class_id,
        "course_class_id": binding.course_class_id,
        "plan_version": binding.plan_version,
        "rule_id": binding.rule_id,
        "rule_version": binding.rule_version,
    }


def _effective_binding_state_read(
    course_class: CourseClass,
    binding: LearningRuleClassBinding | None,
) -> dict:
    return {
        "class_id": course_class.class_id,
        "course_class_id": course_class.id,
        "plan_version": course_class.plan_version,
        "binding_plan_version": binding.plan_version if binding is not None else None,
        "rule_id": binding.rule_id if binding is not None else None,
        "rule_version": binding.rule_version if binding is not None else None,
    }


def _projection_read(projection: LearningActivityProjection) -> dict:
    return {
        "course_unit_id": projection.course_unit_id,
        "activity_key": projection.activity_key,
        "rule_version": projection.rule_version,
        "status": projection.status,
        "learner_event_count": projection.learner_event_count,
        "attempt_count": projection.attempt_count,
        "reported_correct_attempt_count": projection.reported_correct_attempt_count,
        "corrected_count": projection.corrected_count,
        "explained_count": projection.explained_count,
        "first_started_at": _optional_as_utc(projection.first_started_at),
        "last_occurred_at": _optional_as_utc(projection.last_occurred_at),
        "completed_at": _optional_as_utc(projection.completed_at),
        "transferred_at": _optional_as_utc(projection.transferred_at),
        "resume_cursor": dict(projection.resume_cursor_json or {}),
    }


def _fail(status_code: int, code: str, detail: str):
    raise LearningEvidenceError(status_code, code, detail)


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _optional_as_utc(value: datetime | None) -> datetime | None:
    return _as_utc(value) if value is not None else None
