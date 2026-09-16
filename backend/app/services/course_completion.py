"""V8.4 course-unit completion presets and trusted completion facts."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import Request
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.learning_evidence_contract import canonical_sha256
from app.models import Assignment, CheckpointAttempt, ClassGroup, Course, CourseClass, CourseRelease, CourseUnit, LearningCompletionRule, LearningEvidenceEvent, LearningRuleActivation, LearningRuleClassBinding, User
from app.models.base import utc_now
from app.models.learning_evidence import (
    CURRENT_EVENT_SCHEMA_VERSION,
    CURRENT_RULE_DEFINITION_SCHEMA_VERSION,
)
from app.schemas.content_platform import CheckpointAttemptCreate
from app.schemas.content_v2 import (
    CheckpointBlock,
    ContentPageV2,
    OfficialSimulationBlock,
)
from app.schemas.learning_evidence import CompletionActivityRule
from app.services.learning_evidence_access import effective_rule_binding


class CourseCompletionError(Exception):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def prepare_completion_rule_for_release(
    db: Session,
    *,
    actor: User,
    course: Course,
    course_class: CourseClass,
    specs: list[dict[str, Any]],
) -> tuple[int, str, dict[str, Any]]:
    """Create/reuse and bind the canonical preset rule inside publication."""

    activities = [
        _completion_activity_definition(db, spec=spec)
        for spec in sorted(specs, key=lambda item: item["unit"].activity_key)
    ]
    definition = {
        "schema_version": CURRENT_RULE_DEFINITION_SCHEMA_VERSION,
        "activities": activities,
    }
    definition_sha256 = canonical_sha256(definition)
    candidates = list(
        db.scalars(
            select(LearningCompletionRule)
            .where(
                LearningCompletionRule.course_id == course.id,
                LearningCompletionRule.definition_sha256 == definition_sha256,
            )
            .order_by(
                LearningCompletionRule.status.desc(),
                LearningCompletionRule.version_number,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        ).all()
    )
    matching_rules = [
        item
        for item in candidates
        if dict(item.definition_json or {}) == definition
    ]
    rule = next(
        (item for item in matching_rules if item.status == "active"),
        matching_rules[0] if matching_rules else None,
    )
    now = utc_now()
    if rule is None:
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
            status="active",
            definition_json=definition,
            definition_sha256=definition_sha256,
            created_by_user_id=actor.id,
            activated_by_user_id=actor.id,
            activated_at=now,
        )
        db.add(rule)
        db.flush([rule])
    elif rule.status == "draft":
        rule.status = "active"
        rule.activated_by_user_id = actor.id
        rule.activated_at = now
        db.flush([rule])

    activation = db.scalar(
        select(LearningRuleActivation)
        .where(LearningRuleActivation.course_id == course.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if activation is None:
        activation = LearningRuleActivation(
            course_id=course.id,
            active_rule_id=rule.id,
            revision=1,
            activated_by_user_id=actor.id,
            activated_at=now,
        )
        db.add(activation)
    elif activation.active_rule_id != rule.id:
        activation.active_rule_id = rule.id
        activation.revision += 1
        activation.activated_by_user_id = actor.id
        activation.activated_at = now

    current_binding = effective_rule_binding(
        db,
        course_class,
        locking_read=True,
    )
    if current_binding is None or current_binding.rule_id != rule.id:
        if current_binding is not None:
            course_class.plan_version += 1
            db.flush([course_class])
        binding = LearningRuleClassBinding(
            course_class_id=course_class.id,
            plan_version=course_class.plan_version,
            rule_id=rule.id,
            rule_version=rule.version_number,
            created_by_user_id=actor.id,
        )
        db.add(binding)
        db.flush([binding])
    elif current_binding.rule_version != rule.version_number:
        _fail(
            409,
            "course_completion_binding_invalid",
            "Current completion binding has inconsistent rule coordinates",
        )

    snapshot = {
        "rule_id": rule.id,
        "version": rule.version_number,
        "definition": definition,
    }
    return rule.id, rule.definition_sha256, snapshot


def submit_checkpoint_attempt(
    db: Session, *, actor: User, course_id: int, unit_id: int,
    checkpoint_key: str, payload: CheckpointAttemptCreate, request: Request,
) -> dict[str, Any]:
    from app.services.learning_assessments import answer_legacy_checkpoint
    return answer_legacy_checkpoint(db, actor=actor, course_id=course_id, unit_id=unit_id, checkpoint_key=checkpoint_key, payload=payload, request=request)


def _completion_activity_definition(
    db: Session,
    *,
    spec: dict[str, Any],
) -> dict[str, Any]:
    unit: CourseUnit = spec["unit"]
    content: ContentPageV2 = spec["published_content"]
    completion = content.courseUnit.completion if content.courseUnit else None
    if completion is None:
        _fail(
            409,
            "course_completion_missing",
            f"Course unit {unit.id} must choose a completion method before publication",
        )
    payload: dict[str, Any] = {
        "activity_key": unit.activity_key,
        "outcome": "completed",
        "preset": completion.preset,
        "required_event_types": [],
        "minimum_attempts": 0,
        "minimum_correct_attempts": 0,
    }
    if completion.preset == "experiment_operation":
        has_activity = any(
            isinstance(block, OfficialSimulationBlock)
            and block.simulationKey == unit.activity_key
            for block in content.blocks
        )
        if not has_activity:
            _fail(
                422,
                "course_completion_activity_missing",
                f"Course unit {unit.id} must reference its official activity",
            )
        payload["required_event_types"] = ["attempted"]
        payload["minimum_attempts"] = 1
    elif completion.preset == "checkpoint_passed":
        payload["checkpoint_key"] = completion.checkpointKey
    else:
        assignment = db.scalar(
            select(Assignment)
            .where(
                Assignment.id == completion.assignmentId,
                Assignment.unit_id == unit.id,
                Assignment.status == "active",
            )
            .with_for_update()
        )
        if assignment is None:
            _fail(
                422,
                "course_completion_assignment_invalid",
                f"Course unit {unit.id} must target an active assignment in that unit",
            )
        payload["assignment_id"] = assignment.id
    try:
        return CompletionActivityRule.model_validate(payload).model_dump(mode="json")
    except ValidationError as exc:
        message = str(exc.errors(include_url=False)[0].get("msg") or "Invalid completion preset")
        _fail(422, "course_completion_invalid", message)


def _single_internal_course_class(db: Session, course_id: int) -> CourseClass:
    rows = list(
        db.scalars(
            select(CourseClass)
            .join(ClassGroup, ClassGroup.id == CourseClass.class_id)
            .where(
                CourseClass.course_id == course_id,
                CourseClass.status == "active",
                ClassGroup.kind == "course_cohort",
                ClassGroup.status == "active",
            )
            .order_by(CourseClass.id)
        ).all()
    )
    if len(rows) != 1:
        _fail(409, "course_internal_scope_invalid", "Course internal teaching scope is unavailable")
    return rows[0]


def _activity_rule(rule: LearningCompletionRule, activity_key: str) -> dict[str, Any]:
    activity = next(
        (
            item
            for item in rule.definition_json.get("activities", [])
            if item.get("activity_key") == activity_key
        ),
        None,
    )
    if activity is None:
        _fail(409, "course_completion_activity_missing", "Completion rule does not cover this course unit")
    return dict(activity)


def _validated_checkpoint_response(
    checkpoint: CheckpointBlock,
    payload: CheckpointAttemptCreate,
) -> dict[str, Any]:
    if checkpoint.responseType in {"single-choice", "multiple-choice"}:
        if payload.numeric_answer is not None or payload.text_answer is not None:
            _fail(422, "checkpoint_response_type_mismatch", "Checkpoint requires a choice response")
        selected = list(payload.selected_choice_ids)
        if checkpoint.responseType == "single-choice" and len(selected) != 1:
            _fail(422, "checkpoint_response_type_mismatch", "Single-choice checkpoint requires one choice")
        known = {choice.choiceId for choice in checkpoint.choices}
        if not selected or not set(selected).issubset(known):
            _fail(422, "checkpoint_choice_invalid", "Checkpoint response contains an unknown choice")
        return {"selected_choice_ids": sorted(selected)}
    if checkpoint.responseType == "numeric":
        if payload.numeric_answer is None or payload.selected_choice_ids or payload.text_answer is not None:
            _fail(422, "checkpoint_response_type_mismatch", "Checkpoint requires a numeric response")
        return {"numeric_answer": payload.numeric_answer}
    if payload.text_answer is None or payload.selected_choice_ids or payload.numeric_answer is not None:
        _fail(422, "checkpoint_response_type_mismatch", "Checkpoint requires a text response")
    return {"text_answer": payload.text_answer.strip()}


def _grade_checkpoint(checkpoint: CheckpointBlock, response: dict[str, Any]) -> bool:
    if checkpoint.responseType in {"single-choice", "multiple-choice"}:
        return set(response["selected_choice_ids"]) == set(checkpoint.correctChoiceIds)
    if checkpoint.responseType == "numeric":
        tolerance = checkpoint.tolerance or 0.0
        return abs(float(response["numeric_answer"]) - float(checkpoint.numericAnswer)) <= tolerance
    normalized = str(response["text_answer"]).strip().casefold()
    return normalized in {
        answer.strip().casefold() for answer in checkpoint.acceptedAnswers
    }


def _trusted_completion_event(
    *,
    client_event_id: str,
    actor: User,
    subject_user_id: int,
    school_id: int,
    class_id: int,
    course_id: int,
    unit: CourseUnit,
    rule: LearningCompletionRule,
    assignment_id: int | None,
    evidence: dict[str, Any],
    occurred_at: datetime,
) -> LearningEvidenceEvent:
    request_sha256 = canonical_sha256(
        {
            "subject_user_id": subject_user_id,
            "class_id": class_id,
            "course_id": course_id,
            "course_unit_id": unit.id,
            "assignment_id": assignment_id,
            "rule_id": rule.id,
            "rule_version": rule.version_number,
            "evidence": evidence,
        }
    )
    return LearningEvidenceEvent(
        client_event_id=client_event_id,
        request_sha256=request_sha256,
        actor_user_id=actor.id,
        subject_user_id=subject_user_id,
        producer_type="trusted_assessment",
        school_id=school_id,
        class_id=class_id,
        course_id=course_id,
        course_unit_id=unit.id,
        assignment_id=assignment_id,
        activity_key=unit.activity_key,
        rule_id=rule.id,
        rule_version=rule.version_number,
        event_schema_version=CURRENT_EVENT_SCHEMA_VERSION,
        event_type="completed",
        evidence_json=evidence,
        source_event_ids_json=[],
        occurred_at=occurred_at,
        received_at=utc_now(),
    )


def _matching_checkpoint_replay(
    attempt: CheckpointAttempt,
    *,
    actor: User,
    unit: CourseUnit,
    release: CourseRelease,
    checkpoint_key: str,
    request_sha256: str,
) -> bool:
    return (
        attempt.request_sha256 == request_sha256
        and attempt.student_id == actor.id
        and attempt.course_id == release.course_id
        and attempt.course_unit_id == unit.id
        and attempt.course_release_id == release.id
        and attempt.checkpoint_key == checkpoint_key
    )


def _checkpoint_attempt_read(
    attempt: CheckpointAttempt,
    *,
    max_attempts: int | None,
    replayed: bool,
) -> dict[str, Any]:
    remaining = (
        None
        if max_attempts is None
        else max(0, max_attempts - attempt.attempt_number)
    )
    return {
        "id": attempt.id,
        "client_attempt_id": attempt.client_attempt_id,
        "course_release_id": attempt.course_release_id,
        "course_unit_id": attempt.course_unit_id,
        "checkpoint_key": attempt.checkpoint_key,
        "attempt_number": attempt.attempt_number,
        "is_correct": attempt.is_correct,
        "completed": attempt.is_correct and attempt.completion_eligible,
        "remaining_attempts": remaining,
        "replayed": replayed,
        "submitted_at": attempt.submitted_at,
    }


def _fail(status_code: int, code: str, message: str):
    raise CourseCompletionError(status_code, code, message)
