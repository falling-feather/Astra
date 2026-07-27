from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.learning_evidence_contract import MAX_RULE_WITNESS_EVENTS
from app.models import (
    LearningActivityProjection,
    LearningEvidenceEvent,
    LearningResumeProjection,
)
from app.models.learning_evidence import LEARNER_EVENT_TYPES


@dataclass(frozen=True)
class ActivityProjectionScope:
    # Activity identity is the stable CourseUnit row, not a free-form key.
    # CourseUnit keeps (course_id, activity_key) unique and the write service
    # verifies that the supplied key belongs to course_unit_id.
    subject_user_id: int
    school_id: int
    class_id: int
    course_id: int
    course_unit_id: int
    activity_key: str
    rule_id: int
    rule_version: int


@dataclass(frozen=True)
class CompletionDecision:
    outcome: str
    source_event_ids: tuple[int, ...]
    already_derived: bool


def scope_from_event(event: LearningEvidenceEvent) -> ActivityProjectionScope:
    return ActivityProjectionScope(
        subject_user_id=event.subject_user_id,
        school_id=event.school_id,
        class_id=event.class_id,
        course_id=event.course_id,
        course_unit_id=event.course_unit_id,
        activity_key=event.activity_key,
        rule_id=event.rule_id,
        rule_version=event.rule_version,
    )


def completion_decision(
    db: Session,
    *,
    scope: ActivityProjectionScope,
    definition_json: dict,
    locking_read: bool = False,
) -> CompletionDecision | None:
    events = _scope_events(db, scope, locking_read=locking_read)
    invalidated_ids = _invalidated_event_ids(events)
    learner_events = _active_learner_events(events, invalidated_ids)
    activity_rule = _activity_rule(definition_json, scope.activity_key)
    if activity_rule is None:
        return None
    witness_events = _criterion_witness(activity_rule, learner_events)
    if witness_events is None:
        return None
    outcome = str(activity_rule["outcome"])
    valid_derived = _valid_derived_events(events, learner_events, invalidated_ids, outcome)
    return CompletionDecision(
        outcome=outcome,
        source_event_ids=tuple(event.id for event in witness_events),
        already_derived=bool(valid_derived),
    )


def rebuild_activity_projection(
    db: Session,
    *,
    scope: ActivityProjectionScope,
    definition_json: dict,
    locking_read: bool = False,
) -> LearningActivityProjection:
    events = _scope_events(db, scope, locking_read=locking_read)
    invalidated_ids = _invalidated_event_ids(events)
    learner_events = _active_learner_events(events, invalidated_ids)
    activity_rule = _activity_rule(definition_json, scope.activity_key)
    criteria_satisfied = bool(
        activity_rule is not None and _criteria_satisfied(activity_rule, learner_events)
    )
    completed_events = _valid_derived_events(
        events,
        learner_events,
        invalidated_ids,
        "completed",
        rule_criteria_satisfied=criteria_satisfied,
    )
    transferred_events = _valid_derived_events(
        events,
        learner_events,
        invalidated_ids,
        "transferred",
        rule_criteria_satisfied=criteria_satisfied,
    )
    if transferred_events:
        status = "transferred"
    elif completed_events:
        status = "completed"
    elif learner_events:
        status = "in_progress"
    else:
        status = "not_started"

    attempts = [event for event in learner_events if event.event_type == "attempted"]
    latest = max(learner_events, key=_event_order_key) if learner_events else None
    projection_statement = _activity_projection_statement(
        scope,
        locking_read=locking_read,
    )
    projection = db.scalar(
        projection_statement.execution_options(populate_existing=True)
    )
    if projection is None:
        projection = LearningActivityProjection(
            subject_user_id=scope.subject_user_id,
            school_id=scope.school_id,
            class_id=scope.class_id,
            course_id=scope.course_id,
            course_unit_id=scope.course_unit_id,
            activity_key=scope.activity_key,
            rule_id=scope.rule_id,
            rule_version=scope.rule_version,
        )
        db.add(projection)
    else:
        projection.projection_revision += 1
    projection.status = status
    projection.learner_event_count = len(learner_events)
    projection.attempt_count = len(attempts)
    # This is a client-reported observation only. Rule criteria never consume it
    # as authoritative correctness; trusted assessments produce outcomes directly.
    projection.reported_correct_attempt_count = sum(
        1 for event in attempts if event.evidence_json.get("reported_correct") is True
    )
    projection.corrected_count = sum(1 for event in learner_events if event.event_type == "corrected")
    projection.explained_count = sum(1 for event in learner_events if event.event_type == "explained")
    started_events = [event for event in learner_events if event.event_type == "started"]
    projection.first_started_at = (
        min((event.occurred_at for event in started_events), key=_datetime_order_key)
        if started_events
        else None
    )
    projection.last_occurred_at = latest.occurred_at if latest is not None else None
    projection.last_received_at = (
        max((event.received_at for event in learner_events), key=_datetime_order_key)
        if learner_events
        else None
    )
    projection.completed_at = _first_event_time(completed_events)
    projection.transferred_at = _first_event_time(transferred_events)
    projection.last_event_id = latest.id if latest is not None else None
    projection.resume_cursor_json = _latest_nonempty_cursor(learner_events)
    db.flush([projection])
    rebuild_resume_projection(db, scope=scope, locking_read=locking_read)
    return projection


def rebuild_resume_projection(
    db: Session,
    *,
    scope: ActivityProjectionScope,
    locking_read: bool = False,
) -> LearningResumeProjection | None:
    event_statement = _resume_events_statement(
        scope,
        locking_read=locking_read,
    )
    events = list(db.scalars(event_statement).all())
    invalidated_ids = _invalidated_event_ids(events)
    learner_events = _active_learner_events(events, invalidated_ids)
    latest = max(learner_events, key=_event_order_key) if learner_events else None
    resume_statement = _resume_projection_statement(
        scope,
        locking_read=locking_read,
    )
    resume = db.scalar(
        resume_statement.execution_options(populate_existing=True)
    )
    if latest is None:
        if resume is not None:
            db.delete(resume)
            db.flush()
        return None
    if resume is None:
        resume = LearningResumeProjection(
            subject_user_id=scope.subject_user_id,
            school_id=scope.school_id,
            class_id=scope.class_id,
            course_id=scope.course_id,
            course_unit_id=latest.course_unit_id,
            activity_key=latest.activity_key,
            rule_id=scope.rule_id,
            rule_version=scope.rule_version,
            last_event_id=latest.id,
            last_occurred_at=latest.occurred_at,
        )
        db.add(resume)
    resume.course_unit_id = latest.course_unit_id
    resume.activity_key = latest.activity_key
    resume.rule_version = latest.rule_version
    resume.last_event_id = latest.id
    resume.last_occurred_at = latest.occurred_at
    latest_activity_events = [
        event
        for event in learner_events
        if event.course_unit_id == latest.course_unit_id
        and event.activity_key == latest.activity_key
    ]
    resume.cursor_json = _latest_nonempty_cursor(latest_activity_events)
    db.flush([resume])
    return resume


def rebuild_subject_course_projections(
    db: Session,
    *,
    subject_user_id: int,
    class_id: int,
    course_id: int,
    definitions_by_rule_id: dict[int, dict],
    locking_read: bool = False,
) -> tuple[int, int]:
    event_statement = select(LearningEvidenceEvent).where(
        LearningEvidenceEvent.subject_user_id == subject_user_id,
        LearningEvidenceEvent.class_id == class_id,
        LearningEvidenceEvent.course_id == course_id,
    )
    if locking_read:
        event_statement = event_statement.with_for_update()
    event_rows = list(db.scalars(event_statement).all())
    scopes: dict[tuple[int, int], ActivityProjectionScope] = {}
    for event in event_rows:
        scopes[(event.course_unit_id, event.rule_id)] = scope_from_event(event)
    if locking_read:
        list(
            db.scalars(
                select(LearningActivityProjection)
                .where(
                    LearningActivityProjection.subject_user_id
                    == subject_user_id,
                    LearningActivityProjection.class_id == class_id,
                    LearningActivityProjection.course_id == course_id,
                )
                .with_for_update()
            ).all()
        )
        list(
            db.scalars(
                select(LearningResumeProjection)
                .where(
                    LearningResumeProjection.subject_user_id == subject_user_id,
                    LearningResumeProjection.class_id == class_id,
                    LearningResumeProjection.course_id == course_id,
                )
                .with_for_update()
            ).all()
        )
    db.execute(
        delete(LearningActivityProjection).where(
            LearningActivityProjection.subject_user_id == subject_user_id,
            LearningActivityProjection.class_id == class_id,
            LearningActivityProjection.course_id == course_id,
        )
    )
    db.execute(
        delete(LearningResumeProjection).where(
            LearningResumeProjection.subject_user_id == subject_user_id,
            LearningResumeProjection.class_id == class_id,
            LearningResumeProjection.course_id == course_id,
        )
    )
    for scope in scopes.values():
        definition = definitions_by_rule_id.get(scope.rule_id)
        if definition is not None:
            rebuild_activity_projection(
                db,
                scope=scope,
                definition_json=definition,
                locking_read=locking_read,
            )
    resume_count = int(
        db.scalar(
            (
                select(LearningResumeProjection.id).where(
                LearningResumeProjection.subject_user_id == subject_user_id,
                LearningResumeProjection.class_id == class_id,
                LearningResumeProjection.course_id == course_id,
                )
                .with_for_update()
                if locking_read
                else select(LearningResumeProjection.id).where(
                    LearningResumeProjection.subject_user_id == subject_user_id,
                    LearningResumeProjection.class_id == class_id,
                    LearningResumeProjection.course_id == course_id,
                )
            )
        )
        is not None
    )
    return len(scopes), resume_count


def _scope_events(
    db: Session,
    scope: ActivityProjectionScope,
    *,
    locking_read: bool = False,
) -> list[LearningEvidenceEvent]:
    statement = _scope_events_statement(scope, locking_read=locking_read)
    return list(db.scalars(statement).all())


def _scope_events_statement(
    scope: ActivityProjectionScope,
    *,
    locking_read: bool = False,
):
    statement = select(LearningEvidenceEvent).where(
        LearningEvidenceEvent.subject_user_id == scope.subject_user_id,
        LearningEvidenceEvent.class_id == scope.class_id,
        LearningEvidenceEvent.course_id == scope.course_id,
        LearningEvidenceEvent.course_unit_id == scope.course_unit_id,
        LearningEvidenceEvent.rule_id == scope.rule_id,
    )
    if locking_read:
        statement = statement.with_for_update()
    return statement


def _activity_projection_statement(
    scope: ActivityProjectionScope,
    *,
    locking_read: bool = False,
):
    statement = select(LearningActivityProjection).where(
        LearningActivityProjection.subject_user_id == scope.subject_user_id,
        LearningActivityProjection.class_id == scope.class_id,
        LearningActivityProjection.course_id == scope.course_id,
        LearningActivityProjection.course_unit_id == scope.course_unit_id,
        LearningActivityProjection.rule_id == scope.rule_id,
    )
    return statement.with_for_update() if locking_read else statement


def _resume_events_statement(
    scope: ActivityProjectionScope,
    *,
    locking_read: bool = False,
):
    statement = select(LearningEvidenceEvent).where(
        LearningEvidenceEvent.subject_user_id == scope.subject_user_id,
        LearningEvidenceEvent.class_id == scope.class_id,
        LearningEvidenceEvent.course_id == scope.course_id,
        LearningEvidenceEvent.rule_id == scope.rule_id,
    )
    return statement.with_for_update() if locking_read else statement


def _resume_projection_statement(
    scope: ActivityProjectionScope,
    *,
    locking_read: bool = False,
):
    statement = select(LearningResumeProjection).where(
        LearningResumeProjection.subject_user_id == scope.subject_user_id,
        LearningResumeProjection.class_id == scope.class_id,
        LearningResumeProjection.course_id == scope.course_id,
        LearningResumeProjection.rule_id == scope.rule_id,
    )
    return statement.with_for_update() if locking_read else statement


def _invalidated_event_ids(events: list[LearningEvidenceEvent]) -> set[int]:
    return {
        int(event.corrects_event_id)
        for event in events
        if event.event_type == "administrative_correction" and event.corrects_event_id is not None
    }


def _active_learner_events(
    events: list[LearningEvidenceEvent],
    invalidated_ids: set[int],
) -> list[LearningEvidenceEvent]:
    return sorted(
        [
            event
            for event in events
            if event.producer_type == "learner"
            and event.event_type in LEARNER_EVENT_TYPES
            and event.id not in invalidated_ids
        ],
        key=_event_order_key,
    )


def _valid_derived_events(
    events: list[LearningEvidenceEvent],
    learner_events: list[LearningEvidenceEvent],
    invalidated_ids: set[int],
    outcome: str,
    *,
    rule_criteria_satisfied: bool = True,
) -> list[LearningEvidenceEvent]:
    active_learner_ids = {event.id for event in learner_events}
    valid: list[LearningEvidenceEvent] = []
    for event in events:
        if event.id in invalidated_ids or event.event_type != outcome:
            continue
        source_ids = {int(source_id) for source_id in (event.source_event_ids_json or [])}
        if event.producer_type == "trusted_assessment" or (
            event.producer_type == "rule"
            and rule_criteria_satisfied
            and source_ids
            and source_ids.issubset(active_learner_ids)
        ):
            valid.append(event)
    return sorted(valid, key=_event_order_key)


def _activity_rule(definition_json: dict, activity_key: str) -> dict | None:
    for rule in definition_json.get("activities", []):
        if rule.get("activity_key") == activity_key:
            return dict(rule)
    return None


def _criteria_satisfied(
    activity_rule: dict,
    learner_events: list[LearningEvidenceEvent],
) -> bool:
    return _criterion_witness(activity_rule, learner_events) is not None


def _criterion_witness(
    activity_rule: dict,
    learner_events: list[LearningEvidenceEvent],
) -> list[LearningEvidenceEvent] | None:
    observed_types = {event.event_type for event in learner_events}
    required_types = set(activity_rule.get("required_event_types") or [])
    attempts = [event for event in learner_events if event.event_type == "attempted"]
    minimum_attempts = int(activity_rule.get("minimum_attempts") or 0)
    minimum_correct_attempts = int(activity_rule.get("minimum_correct_attempts") or 0)
    if (
        minimum_correct_attempts > 0
        or minimum_attempts > MAX_RULE_WITNESS_EVENTS
        or not required_types.issubset(observed_types)
        or len(attempts) < minimum_attempts
    ):
        return None

    selected: dict[int, LearningEvidenceEvent] = {}
    selected_attempt_count = 0
    for event in attempts:
        if selected_attempt_count >= minimum_attempts:
            break
        if event.id not in selected:
            selected[event.id] = event
            selected_attempt_count += 1
    for event_type in sorted(required_types):
        if any(event.event_type == event_type for event in selected.values()):
            continue
        selected_event = next(
            event for event in learner_events if event.event_type == event_type
        )
        selected[selected_event.id] = selected_event
    witness = sorted(selected.values(), key=_event_order_key)
    if not witness or len(witness) > MAX_RULE_WITNESS_EVENTS:
        return None
    return witness


def _event_cursor(event: LearningEvidenceEvent | None) -> dict[str, Any]:
    if event is None:
        return {}
    cursor = event.evidence_json.get("cursor")
    return dict(cursor) if isinstance(cursor, dict) else {}


def _latest_nonempty_cursor(events: list[LearningEvidenceEvent]) -> dict[str, Any]:
    for event in reversed(sorted(events, key=_event_order_key)):
        cursor = _event_cursor(event)
        if cursor:
            return cursor
    return {}


def _first_event_time(events: list[LearningEvidenceEvent]) -> datetime | None:
    if not events:
        return None
    return min((event.occurred_at for event in events), key=_datetime_order_key)


def _event_order_key(event: LearningEvidenceEvent) -> tuple[datetime, int]:
    return (_as_utc(event.occurred_at), event.id)


def _datetime_order_key(value: datetime) -> datetime:
    return _as_utc(value)


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
