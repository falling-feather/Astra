"""V8.4 course-unit completion presets and trusted completion facts."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import HTTPException, Request
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.learning_evidence_contract import (
    LearningEvidenceError,
    canonical_sha256,
    learning_evidence_write_gate,
)
from app.models import (
    Assignment,
    CheckpointAttempt,
    ClassGroup,
    Course,
    CourseClass,
    CourseClassReleaseBinding,
    CourseEnrollment,
    CourseRelease,
    CourseReleaseUnit,
    CourseUnit,
    LearningCompletionRule,
    LearningEvidenceEvent,
    LearningRuleActivation,
    LearningRuleClassBinding,
    Submission,
    User,
)
from app.models.base import utc_now
from app.models.content import ContentPageVersion
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
from app.services.audit import record_audit_log
from app.services.learning_evidence import lock_learner_evidence_scope
from app.services.learning_evidence_access import (
    effective_bound_rule,
    effective_rule_binding,
)
from app.services.learning_evidence_projection import (
    rebuild_activity_projection,
    scope_from_event,
)


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
    db: Session,
    *,
    actor: User,
    course_id: int,
    unit_id: int,
    checkpoint_key: str,
    payload: CheckpointAttemptCreate,
    request: Request,
) -> dict[str, Any]:
    gate = learning_evidence_write_gate(db.get_bind().dialect.name)
    with gate:
        return _submit_checkpoint_attempt_locked(
            db,
            actor=actor,
            course_id=course_id,
            unit_id=unit_id,
            checkpoint_key=checkpoint_key,
            payload=payload,
            request=request,
        )


def _submit_checkpoint_attempt_locked(
    db: Session,
    *,
    actor: User,
    course_id: int,
    unit_id: int,
    checkpoint_key: str,
    payload: CheckpointAttemptCreate,
    request: Request,
) -> dict[str, Any]:
    if actor.role != "student" or actor.status != "active":
        _fail(403, "student_role_required", "Only active students can answer checkpoints")
    unit = db.get(CourseUnit, unit_id)
    if unit is None or unit.course_id != course_id:
        _fail(404, "course_unit_not_found", "Course unit not found")
    course_class = _single_internal_course_class(db, course_id)
    preliminary_binding = effective_rule_binding(db, course_class)
    if preliminary_binding is None:
        _fail(409, "course_completion_rule_missing", "Course completion rule is unavailable")
    try:
        scope = lock_learner_evidence_scope(
            db,
            subject=actor,
            class_id=course_class.class_id,
            course_id=course_id,
            course_unit_id=unit.id,
            activity_key=unit.activity_key,
            rule_version=preliminary_binding.rule_version,
            assignment_id=None,
        )
    except LearningEvidenceError as exc:
        _fail(exc.status_code, exc.code, exc.detail)
    except HTTPException as exc:
        _fail(exc.status_code, "checkpoint_scope_invalid", str(exc.detail))

    enrollment = db.scalar(
        select(CourseEnrollment)
        .where(
            CourseEnrollment.course_id == course_id,
            CourseEnrollment.student_id == actor.id,
            CourseEnrollment.status == "active",
        )
        .with_for_update()
    )
    if enrollment is None:
        _fail(403, "course_enrollment_required", "Active course enrollment is required")

    current_release_binding = db.scalar(
        select(CourseClassReleaseBinding)
        .where(CourseClassReleaseBinding.course_class_id == scope["course_class"].id)
        .order_by(
            CourseClassReleaseBinding.binding_revision.desc(),
            CourseClassReleaseBinding.id.desc(),
        )
        .limit(1)
        .with_for_update()
    )
    if current_release_binding is None:
        _fail(409, "course_release_missing", "Course has no current content release")
    if current_release_binding.course_release_id != payload.course_release_id:
        _fail(409, "course_release_stale", "Checkpoint attempt targets an old course release")
    release = db.get(CourseRelease, current_release_binding.course_release_id)
    if release is None or release.course_id != course_id:
        _fail(409, "course_release_invalid", "Current course release is invalid")
    if release.completion_rule_id != scope["rule"].id:
        _fail(409, "course_release_rule_mismatch", "Course release and completion rule do not match")

    release_unit = db.scalar(
        select(CourseReleaseUnit).where(
            CourseReleaseUnit.course_release_id == release.id,
            CourseReleaseUnit.source_course_unit_id == unit.id,
        )
    )
    if release_unit is None:
        _fail(404, "course_release_unit_not_found", "Course unit is absent from the current release")
    version = db.get(ContentPageVersion, release_unit.content_page_version_id)
    if version is None:
        _fail(409, "course_release_content_missing", "Released course content is missing")
    content = ContentPageV2.model_validate(version.schema_json)
    checkpoint = next(
        (
            block
            for block in content.blocks
            if isinstance(block, CheckpointBlock)
            and block.checkpointKey == checkpoint_key
        ),
        None,
    )
    if checkpoint is None:
        _fail(404, "checkpoint_not_found", "Checkpoint not found in the current release")
    if checkpoint.mode != "inline":
        _fail(422, "checkpoint_not_server_gradable", "Question-set checkpoints cannot be graded here")
    activity_rule = _activity_rule(scope["rule"], unit.activity_key)
    if (
        activity_rule.get("preset") != "checkpoint_passed"
        or activity_rule.get("checkpoint_key") != checkpoint_key
    ):
        _fail(422, "checkpoint_completion_target_mismatch", "Checkpoint is not this unit's completion target")

    response = _validated_checkpoint_response(checkpoint, payload)
    request_sha256 = canonical_sha256(
        {
            "student_id": actor.id,
            "course_id": course_id,
            "course_unit_id": unit.id,
            "course_release_id": release.id,
            "checkpoint_key": checkpoint_key,
            "response": response,
        }
    )
    replay = db.scalar(
        select(CheckpointAttempt)
        .where(CheckpointAttempt.client_attempt_id == payload.client_attempt_id)
        .with_for_update()
    )
    if replay is not None:
        if not _matching_checkpoint_replay(
            replay,
            actor=actor,
            unit=unit,
            release=release,
            checkpoint_key=checkpoint_key,
            request_sha256=request_sha256,
        ):
            _fail(409, "checkpoint_attempt_id_conflict", "Checkpoint attempt id was reused with different data")
        return _checkpoint_attempt_read(
            replay,
            max_attempts=checkpoint.maxAttempts,
            replayed=True,
        )

    attempt_number = int(
        db.scalar(
            select(func.max(CheckpointAttempt.attempt_number)).where(
                CheckpointAttempt.student_id == actor.id,
                CheckpointAttempt.course_release_id == release.id,
                CheckpointAttempt.course_unit_id == unit.id,
                CheckpointAttempt.checkpoint_key == checkpoint_key,
            )
        )
        or 0
    ) + 1
    if checkpoint.maxAttempts is not None and attempt_number > checkpoint.maxAttempts:
        _fail(409, "checkpoint_attempt_limit_reached", "Checkpoint attempt limit has been reached")

    submitted_at = utc_now()
    is_correct = _grade_checkpoint(checkpoint, response)
    attempt = CheckpointAttempt(
        client_attempt_id=payload.client_attempt_id,
        request_sha256=request_sha256,
        student_id=actor.id,
        class_id=scope["class_group"].id,
        course_id=course_id,
        course_unit_id=unit.id,
        course_release_id=release.id,
        content_page_version_id=version.id,
        checkpoint_key=checkpoint_key,
        rule_id=scope["rule"].id,
        rule_version=scope["rule"].version_number,
        attempt_number=attempt_number,
        response_json=response,
        response_sha256=canonical_sha256(response),
        is_correct=is_correct,
        submitted_at=submitted_at,
    )
    db.add(attempt)
    db.flush([attempt])
    if is_correct:
        event = _trusted_completion_event(
            client_event_id=f"@assessment:checkpoint:{attempt.id}",
            actor=actor,
            subject_user_id=actor.id,
            school_id=scope["course"].school_id,
            class_id=scope["class_group"].id,
            course_id=course_id,
            unit=unit,
            rule=scope["rule"],
            assignment_id=None,
            evidence={
                "preset": "checkpoint_passed",
                "checkpoint_key": checkpoint_key,
                "checkpoint_attempt_id": attempt.id,
                "course_release_id": release.id,
                "is_correct": True,
            },
            occurred_at=submitted_at,
        )
        db.add(event)
        db.flush([event])
        rebuild_activity_projection(
            db,
            scope=scope_from_event(event),
            definition_json=scope["rule"].definition_json,
            locking_read=True,
        )
    record_audit_log(
        db,
        actor=actor,
        action="course.checkpoint.attempt",
        resource_type="checkpoint_attempt",
        resource_id=attempt.id,
        school_id=scope["course"].school_id,
        class_id=scope["class_group"].id,
        event_result="success",
        request=request,
        snapshot={
            "course_id": course_id,
            "course_unit_id": unit.id,
            "course_release_id": release.id,
            "checkpoint_key": checkpoint_key,
            "attempt_number": attempt_number,
            "is_correct": is_correct,
        },
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise CourseCompletionError(
            409,
            "checkpoint_attempt_conflict",
            "Checkpoint attempt changed concurrently; retry with the same attempt id",
        ) from exc
    db.refresh(attempt)
    return _checkpoint_attempt_read(
        attempt,
        max_attempts=checkpoint.maxAttempts,
        replayed=False,
    )


def append_assignment_review_completion(
    db: Session,
    *,
    actor: User,
    course: Course,
    unit: CourseUnit,
    assignment: Assignment,
    submission: Submission,
    class_group: ClassGroup,
) -> LearningEvidenceEvent | None:
    """Append the first qualifying assignment-review completion in caller tx."""

    if class_group.kind != "course_cohort":
        return None
    course_class = db.scalar(
        select(CourseClass)
        .where(
            CourseClass.course_id == course.id,
            CourseClass.class_id == class_group.id,
            CourseClass.status == "active",
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if course_class is None:
        _fail(409, "course_internal_scope_invalid", "Course internal teaching scope is unavailable")
    release_binding = db.scalar(
        select(CourseClassReleaseBinding)
        .where(CourseClassReleaseBinding.course_class_id == course_class.id)
        .order_by(
            CourseClassReleaseBinding.binding_revision.desc(),
            CourseClassReleaseBinding.id.desc(),
        )
        .limit(1)
        .with_for_update()
    )
    if release_binding is None:
        return None
    release = db.get(CourseRelease, release_binding.course_release_id)
    if release is None:
        _fail(409, "course_release_invalid", "Current course release is invalid")
    if release.completion_rule_id is None:
        return None
    binding = effective_rule_binding(db, course_class, locking_read=True)
    if binding is None:
        _fail(409, "course_completion_binding_missing", "Course completion binding is unavailable")
    try:
        rule = effective_bound_rule(
            db,
            course_class=course_class,
            binding=binding,
            locking_read=True,
        )
    except HTTPException as exc:
        _fail(exc.status_code, "course_completion_binding_invalid", str(exc.detail))
    if release.completion_rule_id != rule.id:
        _fail(409, "course_release_rule_mismatch", "Course release and completion rule do not match")
    activity_rule = _activity_rule(rule, unit.activity_key)
    if (
        activity_rule.get("preset") != "assignment_reviewed"
        or activity_rule.get("assignment_id") != assignment.id
    ):
        return None
    if submission.status not in {"graded", "returned"}:
        return None
    if submission.score is None and not (submission.feedback or "").strip():
        return None

    client_event_id = f"@assessment:assignment:{rule.id}:{submission.id}"
    existing = db.scalar(
        select(LearningEvidenceEvent)
        .where(LearningEvidenceEvent.client_event_id == client_event_id)
        .with_for_update()
    )
    if existing is not None:
        if not _matching_assignment_completion(
            existing,
            submission=submission,
            assignment=assignment,
            unit=unit,
            rule=rule,
        ):
            _fail(409, "assignment_completion_key_conflict", "Assignment completion key is inconsistent")
        return existing

    event = _trusted_completion_event(
        client_event_id=client_event_id,
        actor=actor,
        subject_user_id=submission.student_id,
        school_id=course.school_id,
        class_id=class_group.id,
        course_id=course.id,
        unit=unit,
        rule=rule,
        assignment_id=assignment.id,
        evidence={
            "preset": "assignment_reviewed",
            "assignment_id": assignment.id,
            "submission_id": submission.id,
            "review_status": submission.status,
        },
        occurred_at=submission.graded_at or utc_now(),
    )
    db.add(event)
    db.flush([event])
    rebuild_activity_projection(
        db,
        scope=scope_from_event(event),
        definition_json=rule.definition_json,
        locking_read=True,
    )
    return event


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


def _matching_assignment_completion(
    event: LearningEvidenceEvent,
    *,
    submission: Submission,
    assignment: Assignment,
    unit: CourseUnit,
    rule: LearningCompletionRule,
) -> bool:
    evidence = dict(event.evidence_json or {})
    return (
        event.producer_type == "trusted_assessment"
        and event.event_type == "completed"
        and event.subject_user_id == submission.student_id
        and event.class_id == submission.class_id
        and event.course_id == unit.course_id
        and event.course_unit_id == unit.id
        and event.assignment_id == assignment.id
        and event.rule_id == rule.id
        and event.rule_version == rule.version_number
        and evidence.get("preset") == "assignment_reviewed"
        and evidence.get("assignment_id") == assignment.id
        and evidence.get("submission_id") == submission.id
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
        "completed": attempt.is_correct,
        "remaining_attempts": remaining,
        "replayed": replayed,
        "submitted_at": attempt.submitted_at,
    }


def _fail(status_code: int, code: str, message: str):
    raise CourseCompletionError(status_code, code, message)
