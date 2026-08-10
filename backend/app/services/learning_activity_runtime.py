"""Authoritative activity runtime identity, append, and server recovery.

The legacy evidence service remains the owner of general evidence, course-rule
derivation, and compatibility projections.  This module owns the exact runtime
half-package consumed by the learning-activity client.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.learning_evidence_contract import (
    LEARNING_ACTIVITY_EVIDENCE_SIDECAR_SCHEMA,
    LEARNING_ACTIVITY_EVENT_SCHEMA,
    LEARNING_ACTIVITY_RECOVERY_SCHEMA,
    LEARNING_ACTIVITY_SERVER_RECOVERY_SCHEMA,
    MAX_ACTIVITY_RUNTIME_LEARNER_EVENTS,
    MAX_RULE_WITNESS_EVENTS,
    LearningEvidenceError,
    learning_evidence_write_gate,
)
from app.core.learning_evidence_contract import (
    as_utc as _as_utc,
)
from app.core.learning_evidence_contract import (
    canonical_sha256 as _canonical_sha256,
)
from app.core.learning_evidence_contract import (
    evidence_event_request_sha256 as _event_request_hash,
)
from app.core.learning_evidence_contract import (
    fail_learning_evidence as _fail,
)
from app.core.learning_evidence_contract import (
    validate_event_occurred_at as _validate_occurred_at,
)
from app.models import (
    ClassMembership,
    CourseClass,
    CourseUnit,
    LearningEvidenceEvent,
    School,
    User,
)
from app.models.base import utc_now
from app.models.learning_evidence import (
    CURRENT_EVENT_SCHEMA_VERSION,
    LearningActivityRuntime,
)
from app.schemas.learning_evidence import (
    LearningActivityRuntimeEventCreate,
    LearningActivityRuntimeIdentity,
    LearningActivityRuntimeScope,
)
from app.services.access_control import (
    get_course,
    require_class_member,
)
from app.services.course_release_plans import (
    EffectiveUnitAccess,
    effective_unit_access,
    get_plan_for_unit,
)
from app.services.learning_evidence import (
    append_rule_derived_event,
    insert_evidence_event_or_resolve_replay,
    lock_learner_evidence_scope,
)
from app.services.learning_evidence_access import (
    effective_bound_rule,
    effective_rule_binding,
)
from app.services.learning_evidence_projection import (
    completion_decision,
    rebuild_activity_projection,
    scope_from_event,
)


def learning_activity_authority(
    db: Session,
    *,
    actor: User,
    identity: LearningActivityRuntimeIdentity,
) -> dict:
    runtime_scope = _activity_runtime_read_scope(
        db,
        actor=actor,
        identity=identity,
    )
    runtime = _activity_runtime_by_identity(
        db,
        subject_user_id=actor.id,
        identity=identity,
    )
    if runtime is not None:
        _assert_activity_runtime_identity(
            runtime,
            identity=identity,
            state_schema_version=None,
        )
    return {
        "authorized": True,
        "identity": identity.model_dump(mode="python"),
        "revision": _activity_authority_revision(
            db,
            actor=actor,
            runtime_scope=runtime_scope,
        ),
    }


def learning_activity_release(
    db: Session,
    *,
    actor: User,
    scope: LearningActivityRuntimeScope,
) -> dict:
    release_scope = _activity_release_scope(
        db,
        actor=actor,
        scope=scope,
    )
    return {
        "scope": scope.model_dump(mode="python"),
        "state": release_scope["access"].state,
        "revision": _activity_release_revision(db, release_scope),
    }


def append_learning_activity_event(
    db: Session,
    *,
    actor: User,
    payload: LearningActivityRuntimeEventCreate,
) -> dict:
    with learning_evidence_write_gate(db.get_bind().dialect.name):
        _ensure_sqlite_outer_transaction(db)
        try:
            return _append_learning_activity_event_locked(
                db,
                actor=actor,
                payload=payload,
            )
        except Exception:
            # The app middleware converts unexpected API exceptions to 500.
            # Roll back here so that conversion cannot leave an open Session
            # containing cursor state.  This is also required for Python's
            # legacy sqlite transaction mode, where SAVEPOINT must sit under
            # an explicit outer BEGIN to remain rollback-safe.
            db.rollback()
            raise


def _append_learning_activity_event_locked(
    db: Session,
    *,
    actor: User,
    payload: LearningActivityRuntimeEventCreate,
) -> dict:
    command = payload.command
    if actor.role != "student":
        _fail(
            403,
            "learner_role_required",
            "Only learners can append learning activity runtime facts",
        )
    if payload.schema_version != LEARNING_ACTIVITY_EVIDENCE_SIDECAR_SCHEMA:
        _fail(
            422,
            "activity_sidecar_schema_invalid",
            "Activity evidence sidecar schema is invalid",
        )
    if command.schema_version != LEARNING_ACTIVITY_EVENT_SCHEMA:
        _fail(422, "activity_event_schema_invalid", "Activity event schema is invalid")
    if command.versions.event_schema_version != CURRENT_EVENT_SCHEMA_VERSION:
        _fail(
            409,
            "activity_event_schema_incompatible",
            "Activity event schema version is not supported",
        )
    occurred_at = _validate_occurred_at(
        _parse_activity_timestamp(command.occurred_at)
    )
    sidecar_json = payload.model_dump(mode="json")
    sidecar_sha256 = _canonical_sha256(sidecar_json)
    request_hash = _event_request_hash(
        actor_user_id=actor.id,
        subject_user_id=actor.id,
        producer_type="learner",
        payload=sidecar_json,
    )
    locked_scope = lock_learner_evidence_scope(
        db,
        subject=actor,
        class_id=command.scope.class_id,
        course_id=command.scope.course_id,
        course_unit_id=command.scope.course_unit_id,
        activity_key=command.scope.activity_key,
        rule_version=command.versions.rule_version,
        assignment_id=None,
    )
    current_authority_revision = _activity_authority_revision(
        db,
        actor=actor,
        runtime_scope=locked_scope,
    )
    current_release_revision = _activity_release_revision(
        db,
        locked_scope,
        subject_user_id=actor.id,
    )
    replay = _activity_runtime_replay_receipt(
        db,
        actor=actor,
        payload=payload,
        request_sha256=request_hash,
        sidecar_sha256=sidecar_sha256,
        current_authority_revision=current_authority_revision,
        current_release_revision=current_release_revision,
    )
    if replay is not None:
        return replay

    runtime = _activity_runtime_by_command(
        db,
        subject_user_id=actor.id,
        payload=payload,
        locking_read=True,
    )
    if runtime is None:
        if command.run.sequence != 1:
            _fail(
                409,
                "activity_runtime_learner_sequence_gap",
                "A new activity run must begin at learner sequence 1",
            )
        now = utc_now()
        runtime = LearningActivityRuntime(
            subject_user_id=actor.id,
            subject_identity_kind="learner",
            subject_identity_id=str(actor.id),
            school_id=locked_scope["course"].school_id,
            class_id=locked_scope["class_group"].id,
            course_id=locked_scope["course"].id,
            course_unit_id=locked_scope["unit"].id,
            activity_key=locked_scope["unit"].activity_key,
            run_id=command.run.run_id,
            group_id=command.run.group_id,
            manifest_version=command.versions.manifest_version,
            content_version=command.versions.content_version,
            event_schema_version=command.versions.event_schema_version,
            state_schema_version=payload.snapshot.state_schema_version,
            rule_id=locked_scope["rule"].id,
            rule_version=locked_scope["rule"].version_number,
            generation=command.versions.generation,
            authority_revision=current_authority_revision,
            release_revision=current_release_revision,
            last_learner_sequence=0,
            last_server_sequence=0,
            snapshot_applied_through_learner_sequence=0,
            snapshot_json={},
            snapshot_captured_at=now,
            created_at=now,
            updated_at=now,
        )
        runtime = _insert_activity_runtime_or_read_winner(
            db,
            runtime=runtime,
            subject_user_id=actor.id,
            payload=payload,
        )

    _assert_activity_runtime_subject(runtime, actor=actor)
    _assert_activity_runtime_command(runtime, payload=payload)
    if runtime.authority_revision != current_authority_revision:
        _fail(
            409,
            "activity_authority_revision_stale",
            "Activity authority changed after this run was bound",
        )
    if runtime.release_revision != current_release_revision:
        _fail(
            409,
            "activity_release_revision_stale",
            "Activity release changed after this run was bound",
        )
    expected_learner_sequence = runtime.last_learner_sequence + 1
    if command.run.sequence != expected_learner_sequence:
        code = (
            "activity_runtime_learner_sequence_duplicate"
            if command.run.sequence <= runtime.last_learner_sequence
            else "activity_runtime_learner_sequence_gap"
        )
        _fail(
            409,
            code,
            "Activity runtime expected learner sequence "
            f"{expected_learner_sequence}",
        )
    if runtime.last_learner_sequence >= MAX_ACTIVITY_RUNTIME_LEARNER_EVENTS:
        _fail(
            409,
            "activity_runtime_capacity_reached",
            "Activity runtime learner event capacity is exhausted",
        )

    server_sequence = runtime.last_server_sequence + 1
    received_at = utc_now()
    event = LearningEvidenceEvent(
        client_event_id=command.client_event_id,
        request_sha256=request_hash,
        actor_user_id=actor.id,
        subject_user_id=actor.id,
        producer_type="learner",
        school_id=locked_scope["course"].school_id,
        class_id=locked_scope["class_group"].id,
        course_id=locked_scope["course"].id,
        course_unit_id=locked_scope["unit"].id,
        assignment_id=None,
        activity_key=locked_scope["unit"].activity_key,
        rule_id=locked_scope["rule"].id,
        rule_version=locked_scope["rule"].version_number,
        event_schema_version=command.versions.event_schema_version,
        event_type=command.event_type,
        evidence_json=command.evidence,
        source_event_ids_json=[],
        activity_runtime_id=runtime.id,
        server_sequence=server_sequence,
        learner_sequence=command.run.sequence,
        activity_sidecar_json=sidecar_json,
        activity_sidecar_sha256=sidecar_sha256,
        occurred_at=occurred_at,
        received_at=received_at,
    )
    if not insert_evidence_event_or_resolve_replay(db, event):
        replay = _activity_runtime_replay_receipt(
            db,
            actor=actor,
            payload=payload,
            request_sha256=request_hash,
            sidecar_sha256=sidecar_sha256,
            current_authority_revision=current_authority_revision,
            current_release_revision=current_release_revision,
            locking_read=True,
        )
        if replay is not None:
            return replay
        _fail(
            409,
            "activity_runtime_cursor_race",
            "Activity runtime cursor conflict could not be reconciled",
        )

    runtime.last_learner_sequence = command.run.sequence
    runtime.last_server_sequence = server_sequence
    runtime.snapshot_applied_through_learner_sequence = (
        payload.snapshot.applied_through_learner_sequence
    )
    runtime.snapshot_json = payload.snapshot.data
    runtime.snapshot_captured_at = received_at
    runtime.updated_at = runtime.snapshot_captured_at

    projection_scope = scope_from_event(event)
    decision = completion_decision(
        db,
        scope=projection_scope,
        definition_json=locked_scope["rule"].definition_json,
        locking_read=True,
        activity_runtime_id=runtime.id,
    )
    if decision is not None and not decision.already_derived:
        append_rule_derived_event(
            db,
            actor_user_id=actor.id,
            source_event=event,
            outcome=decision.outcome,
            source_event_ids=decision.source_event_ids,
            locking_read=True,
            activity_runtime=runtime,
        )
    rebuild_activity_projection(
        db,
        scope=projection_scope,
        definition_json=locked_scope["rule"].definition_json,
        locking_read=True,
    )
    db.commit()
    db.refresh(event)
    return _activity_runtime_receipt(event, runtime=runtime, status="confirmed")


def learning_activity_server_recovery(
    db: Session,
    *,
    actor: User,
    identity: LearningActivityRuntimeIdentity,
) -> dict:
    _assert_activity_subject(actor, identity)
    locked_scope = lock_learner_evidence_scope(
        db,
        subject=actor,
        class_id=identity.class_id,
        course_id=identity.course_id,
        course_unit_id=identity.course_unit_id,
        activity_key=identity.activity_key,
        rule_version=identity.rule_version,
        assignment_id=None,
    )
    current_authority_revision = _activity_authority_revision(
        db,
        actor=actor,
        runtime_scope=locked_scope,
    )
    current_release_revision = _activity_release_revision(
        db,
        locked_scope,
        subject_user_id=actor.id,
    )
    runtime = _activity_runtime_by_identity(
        db,
        subject_user_id=actor.id,
        identity=identity,
        locking_read=True,
    )
    if runtime is None:
        legacy_count = int(
            db.scalar(
                select(func.count(LearningEvidenceEvent.id)).where(
                    LearningEvidenceEvent.subject_user_id == actor.id,
                    LearningEvidenceEvent.class_id == identity.class_id,
                    LearningEvidenceEvent.course_id == identity.course_id,
                    LearningEvidenceEvent.course_unit_id == identity.course_unit_id,
                    LearningEvidenceEvent.activity_key == identity.activity_key,
                    LearningEvidenceEvent.activity_runtime_id.is_(None),
                )
            )
            or 0
        )
        if legacy_count:
            return _activity_recovery_unavailable(
                identity,
                reason="legacy_runtime_identity_unavailable",
                manual_intervention_required=True,
            )
        return _activity_empty_server_recovery(
            identity,
            authority_revision=current_authority_revision,
            release_revision=current_release_revision,
        )
    try:
        _assert_activity_runtime_identity(
            runtime,
            identity=identity,
            state_schema_version=None,
        )
    except LearningEvidenceError:
        return _activity_recovery_unavailable(
            identity,
            reason="activity_runtime_identity_conflict",
            manual_intervention_required=True,
        )
    if runtime.authority_revision != current_authority_revision:
        return _activity_recovery_unavailable(
            identity,
            reason="activity_authority_revision_stale",
            manual_intervention_required=True,
        )
    if runtime.release_revision != current_release_revision:
        return _activity_recovery_unavailable(
            identity,
            reason="activity_release_revision_stale",
            manual_intervention_required=True,
        )

    events = list(
        db.scalars(
            select(LearningEvidenceEvent)
            .where(LearningEvidenceEvent.activity_runtime_id == runtime.id)
            .order_by(
                LearningEvidenceEvent.server_sequence,
                LearningEvidenceEvent.id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        ).all()
    )
    invalid_reason = _activity_runtime_history_invalid_reason(
        db,
        runtime=runtime,
        events=events,
    )
    if invalid_reason is not None:
        return _activity_recovery_unavailable(
            identity,
            reason=invalid_reason,
            manual_intervention_required=True,
        )

    projection_state, completion_witness = _activity_runtime_terminal_projection(
        runtime=runtime,
        events=events,
        identity=identity,
    )
    if projection_state in {"completed", "transferred"} and completion_witness is None:
        return _activity_recovery_unavailable(
            identity,
            reason="activity_completion_witness_unproven",
            manual_intervention_required=True,
        )
    identity_payload = identity.model_dump(mode="json")
    event_reads = [
        _activity_server_event_read(
            event,
            identity_payload=identity_payload,
        )
        for event in events
    ]
    snapshot_payload = {
        "identity": identity_payload,
        "state_schema_version": runtime.state_schema_version,
        "applied_through_learner_sequence": (
            runtime.snapshot_applied_through_learner_sequence
        ),
        "data": dict(runtime.snapshot_json or {}),
    }
    snapshot_id = (
        f"runtime:{runtime.id}:{runtime.last_learner_sequence}:"
        f"{runtime.last_server_sequence}:"
        f"{_canonical_sha256(snapshot_payload)[:16]}"
    )
    return {
        "schema_version": LEARNING_ACTIVITY_SERVER_RECOVERY_SCHEMA,
        "consumer_schema_version": LEARNING_ACTIVITY_RECOVERY_SCHEMA,
        "exact_available": True,
        "manual_intervention_required": False,
        "reason": None,
        "snapshot_id": snapshot_id,
        "captured_at": _activity_timestamp(runtime.snapshot_captured_at),
        "identity": identity_payload,
        "freshness": {
            "status": "current",
            "authority_revision": runtime.authority_revision,
            "release_revision": runtime.release_revision,
        },
        "server": {
            "identity": identity_payload,
            "complete_history": True,
            "event_count": len(event_reads),
            "events": event_reads,
            "projection": {
                "state": projection_state,
                "applied_through_server_sequence": (
                    runtime.last_server_sequence
                ),
                "completion_witness": completion_witness,
            },
            "snapshot": snapshot_payload,
        },
        # The browser-owned IndexedDB queue is deliberately outside this
        # response. FE-028 must supply and prove the complete pending set.
        "client_pending_status": "unknown",
    }


def _assert_activity_subject(
    actor: User,
    identity: LearningActivityRuntimeIdentity,
) -> None:
    if actor.role != "student":
        _fail(403, "learner_role_required", "Activity runtime requires learner role")
    if (
        identity.subject_identity.kind != "learner"
        or identity.subject_identity.id != str(actor.id)
    ):
        _fail(
            403,
            "activity_subject_mismatch",
            "Activity runtime subject does not match the authenticated learner",
        )


def _activity_runtime_read_scope(
    db: Session,
    *,
    actor: User,
    identity: LearningActivityRuntimeIdentity,
) -> dict:
    _assert_activity_subject(actor, identity)
    class_group = require_class_member(db, actor, identity.class_id)
    course = get_course(db, identity.course_id)
    if class_group.school_id != course.school_id:
        _fail(
            422,
            "activity_scope_mismatch",
            "Activity authority class does not belong to the course school",
        )
    course_class = db.scalar(
        select(CourseClass).where(
            CourseClass.class_id == identity.class_id,
            CourseClass.course_id == identity.course_id,
        )
    )
    if course_class is None:
        _fail(403, "course_class_missing", "Course is not attached to this class")
    binding = effective_rule_binding(db, course_class)
    if binding is None:
        _fail(
            409,
            "rule_binding_missing",
            "Current class release plan has no completion rule binding",
        )
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
    if identity.rule_version != binding.rule_version:
        _fail(
            409,
            "activity_rule_revision_stale",
            "Activity runtime rule version is not current",
        )
    if identity.event_schema_version != CURRENT_EVENT_SCHEMA_VERSION:
        _fail(
            409,
            "activity_event_schema_incompatible",
            "Activity runtime event schema is not supported",
        )
    unit = db.get(CourseUnit, identity.course_unit_id)
    if (
        unit is None
        or unit.course_id != course.id
        or unit.activity_key != identity.activity_key
    ):
        _fail(404, "activity_scope_not_found", "Activity runtime scope was not found")
    return {
        "class_group": class_group,
        "course": course,
        "unit": unit,
        "course_class": course_class,
        "binding": binding,
        "rule": rule,
        "plan": get_plan_for_unit(db, course_class, unit.id),
    }


def _activity_release_scope(
    db: Session,
    *,
    actor: User,
    scope: LearningActivityRuntimeScope,
) -> dict:
    if actor.role != "student":
        _fail(403, "learner_role_required", "Activity release requires learner role")
    class_group = require_class_member(db, actor, scope.class_id)
    course = get_course(db, scope.course_id)
    if class_group.school_id != course.school_id:
        _fail(
            422,
            "activity_scope_mismatch",
            "Activity release class does not belong to the course school",
        )
    course_class = db.scalar(
        select(CourseClass).where(
            CourseClass.class_id == class_group.id,
            CourseClass.course_id == course.id,
        )
    )
    if course_class is None:
        _fail(403, "course_class_missing", "Course is not attached to this class")
    unit = db.get(CourseUnit, scope.course_unit_id)
    if (
        unit is None
        or unit.course_id != course.id
        or unit.activity_key != scope.activity_key
    ):
        _fail(404, "activity_scope_not_found", "Activity release scope was not found")
    plan = get_plan_for_unit(db, course_class, unit.id)
    release_scope = {
        "subject_user_id": actor.id,
        "class_group": class_group,
        "course": course,
        "unit": unit,
        "course_class": course_class,
        "plan": plan,
    }
    release_scope["access"] = _effective_activity_release_access(
        db,
        release_scope=release_scope,
        subject_user_id=actor.id,
    )
    return release_scope


def _effective_activity_release_access(
    db: Session,
    *,
    release_scope: dict,
    subject_user_id: int,
) -> EffectiveUnitAccess:
    course = release_scope["course"]
    class_group = release_scope["class_group"]
    course_class = release_scope["course_class"]
    unit = release_scope["unit"]
    plan = release_scope.get("plan") or get_plan_for_unit(
        db,
        course_class,
        unit.id,
    )
    access = effective_unit_access(
        db,
        course=course,
        class_group=class_group,
        unit=unit,
        plan=plan,
        student_id=subject_user_id,
    )
    if access.state != "hidden" and course_class.status != "active":
        return EffectiveUnitAccess("locked", ("course_attachment_inactive",))
    return access


def _activity_authority_revision(
    db: Session,
    *,
    actor: User,
    runtime_scope: dict,
) -> str:
    class_group = runtime_scope["class_group"]
    course = runtime_scope["course"]
    course_class = runtime_scope["course_class"]
    unit = runtime_scope["unit"]
    binding = runtime_scope["binding"]
    membership = db.scalar(
        select(ClassMembership).where(
            ClassMembership.class_id == class_group.id,
            ClassMembership.user_id == actor.id,
            ClassMembership.role == "student",
            ClassMembership.status == "active",
        )
    )
    school = db.get(School, class_group.school_id)
    if membership is None or school is None or school.status != "active":
        _fail(403, "activity_authority_denied", "Learner authority is not active")
    return _canonical_sha256(
        {
            "subject_user_id": actor.id,
            "subject_role": actor.role,
            "subject_status": actor.status,
            "subject_updated_at": actor.updated_at,
            "membership_id": membership.id,
            "membership_role": membership.role,
            "membership_status": membership.status,
            "membership_updated_at": membership.updated_at,
            "school_id": school.id,
            "school_status": school.status,
            "school_updated_at": school.updated_at,
            "class_id": class_group.id,
            "class_status": class_group.status,
            "class_updated_at": class_group.updated_at,
            "course_id": course.id,
            "course_class_id": course_class.id,
            "course_class_status": course_class.status,
            "course_unit_id": unit.id,
            "rule_binding_id": binding.id,
            "rule_id": binding.rule_id,
            "rule_version": binding.rule_version,
        }
    )


def _activity_release_revision(
    db: Session,
    release_scope: dict,
    *,
    subject_user_id: int | None = None,
) -> str:
    course = release_scope["course"]
    class_group = release_scope["class_group"]
    course_class = release_scope["course_class"]
    unit = release_scope["unit"]
    plan = release_scope.get("plan") or get_plan_for_unit(
        db,
        course_class,
        unit.id,
    )
    school = db.get(School, course.school_id)
    if school is None:
        _fail(409, "activity_release_invalid", "Activity release school is missing")
    effective_subject_user_id = (
        release_scope.get("subject_user_id") or subject_user_id
    )
    if effective_subject_user_id is None:
        _fail(
            409,
            "activity_release_invalid",
            "Activity release learner subject is missing",
        )
    access = release_scope.get("access") or _effective_activity_release_access(
        db,
        release_scope=release_scope,
        subject_user_id=effective_subject_user_id,
    )
    return _canonical_sha256(
        {
            "subject_user_id": effective_subject_user_id,
            "effective_state": access.state,
            "effective_lock_reasons": list(access.lock_reasons),
            "school_id": school.id,
            "school_status": school.status,
            "school_updated_at": school.updated_at,
            "class_id": class_group.id,
            "class_status": class_group.status,
            "class_updated_at": class_group.updated_at,
            "course_id": course.id,
            "course_status": course.status,
            "course_updated_at": course.updated_at,
            "course_class_id": course_class.id,
            "course_class_status": course_class.status,
            "plan_version": course_class.plan_version,
            "course_class_updated_at": course_class.updated_at,
            "course_unit_id": unit.id,
            "unit_status": unit.status,
            "unit_updated_at": unit.updated_at,
            "plan_id": plan.id,
            "release_mode": plan.release_mode,
            "open_at": plan.open_at,
            "prerequisite_unit_id": plan.prerequisite_unit_id,
            "plan_updated_at": plan.updated_at,
        }
    )


def _parse_activity_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value[:-1] + "+00:00")


def _ensure_sqlite_outer_transaction(db: Session) -> None:
    """Put runtime savepoints under a real SQLite transaction.

    The same-process SQLite write gate is a local-development aid only. MySQL
    correctness remains the row lock, unique constraints, and savepoint winner
    reread used below.
    """

    if db.get_bind().dialect.name != "sqlite":
        return
    connection = db.connection()
    driver_connection = connection.connection.driver_connection
    if not driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN")


def _activity_timestamp(value: datetime) -> str:
    return (
        _as_utc(value)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _activity_server_event_id(event_id: int) -> str:
    return f"learning-evidence-event:{event_id}"


def _insert_activity_runtime_or_read_winner(
    db: Session,
    *,
    runtime: LearningActivityRuntime,
    subject_user_id: int,
    payload: LearningActivityRuntimeEventCreate,
) -> LearningActivityRuntime:
    """Create one runtime or lock the database-unique concurrent winner."""

    try:
        with db.begin_nested():
            db.add(runtime)
            db.flush([runtime])
        return runtime
    except IntegrityError:
        if runtime in db:
            db.expunge(runtime)
    winner = _activity_runtime_by_command(
        db,
        subject_user_id=subject_user_id,
        payload=payload,
        locking_read=True,
    )
    if winner is None:
        _fail(
            409,
            "activity_runtime_identity_race",
            "Activity runtime identity conflict could not be reconciled",
        )
    return winner


def _activity_server_event_read(
    event: LearningEvidenceEvent,
    *,
    identity_payload: dict,
) -> dict:
    base = {
        "identity": identity_payload,
        "server_sequence": event.server_sequence,
        "server_event_id": _activity_server_event_id(event.id),
        "learner_sequence": event.learner_sequence,
        "event_type": event.event_type,
        "producer": "learner" if event.producer_type == "learner" else "server",
    }
    if event.producer_type == "learner":
        sidecar = dict(event.activity_sidecar_json or {})
        command = sidecar.get("command") if isinstance(sidecar, dict) else None
        return {
            **base,
            "occurred_at": (
                command.get("occurred_at")
                if isinstance(command, dict)
                else _activity_timestamp(event.occurred_at)
            ),
            "sidecar": sidecar,
        }
    return {
        **base,
        "occurred_at": _activity_timestamp(event.occurred_at),
        "evidence": dict(event.evidence_json or {}),
    }


def _activity_runtime_by_identity(
    db: Session,
    *,
    subject_user_id: int,
    identity: LearningActivityRuntimeIdentity,
    locking_read: bool = False,
) -> LearningActivityRuntime | None:
    statement = select(LearningActivityRuntime).where(
        LearningActivityRuntime.subject_user_id == subject_user_id,
        LearningActivityRuntime.class_id == identity.class_id,
        LearningActivityRuntime.course_id == identity.course_id,
        LearningActivityRuntime.course_unit_id == identity.course_unit_id,
        LearningActivityRuntime.run_id == identity.run_id,
        LearningActivityRuntime.group_id == identity.group_id,
    )
    if locking_read:
        statement = statement.with_for_update()
    return db.scalar(statement.execution_options(populate_existing=True))


def _activity_runtime_by_command(
    db: Session,
    *,
    subject_user_id: int,
    payload: LearningActivityRuntimeEventCreate,
    locking_read: bool = False,
) -> LearningActivityRuntime | None:
    command = payload.command
    identity = LearningActivityRuntimeIdentity.model_validate(
        {
            **command.scope.model_dump(mode="python"),
            "subject_identity": {"kind": "learner", "id": str(subject_user_id)},
            "run_id": command.run.run_id,
            "group_id": command.run.group_id,
            **command.versions.model_dump(mode="python"),
        }
    )
    return _activity_runtime_by_identity(
        db,
        subject_user_id=subject_user_id,
        identity=identity,
        locking_read=locking_read,
    )


def _assert_activity_runtime_identity(
    runtime: LearningActivityRuntime,
    *,
    identity: LearningActivityRuntimeIdentity,
    state_schema_version: str | None,
) -> None:
    expected = (
        identity.subject_identity.kind,
        identity.subject_identity.id,
        identity.class_id,
        identity.course_id,
        identity.course_unit_id,
        identity.activity_key,
        identity.run_id,
        identity.group_id,
        identity.manifest_version,
        identity.content_version,
        identity.event_schema_version,
        identity.rule_version,
        identity.generation,
    )
    actual = (
        runtime.subject_identity_kind,
        runtime.subject_identity_id,
        runtime.class_id,
        runtime.course_id,
        runtime.course_unit_id,
        runtime.activity_key,
        runtime.run_id,
        runtime.group_id,
        runtime.manifest_version,
        runtime.content_version,
        runtime.event_schema_version,
        runtime.rule_version,
        runtime.generation,
    )
    if actual != expected or (
        state_schema_version is not None
        and runtime.state_schema_version != state_schema_version
    ):
        _fail(
            409,
            "activity_runtime_identity_conflict",
            "Activity run identity or version binding changed",
        )


def _assert_activity_runtime_command(
    runtime: LearningActivityRuntime,
    *,
    payload: LearningActivityRuntimeEventCreate,
) -> None:
    command = payload.command
    identity = LearningActivityRuntimeIdentity.model_validate(
        {
            **command.scope.model_dump(mode="python"),
            "subject_identity": {
                "kind": "learner",
                "id": runtime.subject_identity_id,
            },
            "run_id": command.run.run_id,
            "group_id": command.run.group_id,
            **command.versions.model_dump(mode="python"),
        }
    )
    _assert_activity_runtime_identity(
        runtime,
        identity=identity,
        state_schema_version=payload.snapshot.state_schema_version,
    )


def _assert_activity_runtime_subject(
    runtime: LearningActivityRuntime,
    *,
    actor: User,
) -> None:
    if (
        runtime.subject_user_id != actor.id
        or runtime.subject_identity_kind != "learner"
        or runtime.subject_identity_id != str(actor.id)
    ):
        _fail(
            409,
            "activity_runtime_subject_conflict",
            "Persisted activity runtime subject does not match the learner",
        )


def _activity_runtime_replay_receipt(
    db: Session,
    *,
    actor: User,
    payload: LearningActivityRuntimeEventCreate,
    request_sha256: str,
    sidecar_sha256: str,
    current_authority_revision: str,
    current_release_revision: str,
    locking_read: bool = False,
) -> dict | None:
    command = payload.command
    statement = select(LearningEvidenceEvent).where(
        LearningEvidenceEvent.client_event_id == command.client_event_id
    )
    if locking_read:
        statement = statement.with_for_update()
    existing = db.scalar(statement)
    if existing is None:
        return None
    if existing.actor_user_id != actor.id or existing.subject_user_id != actor.id:
        _fail(
            403,
            "idempotency_scope_mismatch",
            "client_event_id belongs to another actor or subject",
        )
    if (
        existing.request_sha256 != request_sha256
        or existing.activity_sidecar_sha256 != sidecar_sha256
        or existing.activity_sidecar_json != payload.model_dump(mode="json")
    ):
        _fail(
            409,
            "idempotency_payload_conflict",
            "client_event_id was used with another activity payload",
        )
    if existing.activity_runtime_id is None:
        _fail(
            409,
            "activity_runtime_identity_conflict",
            "client_event_id belongs to a legacy event without runtime identity",
        )
    runtime = db.get(LearningActivityRuntime, existing.activity_runtime_id)
    if runtime is None:
        _fail(409, "activity_runtime_missing", "Activity runtime row is missing")
    _assert_activity_runtime_subject(runtime, actor=actor)
    _assert_activity_runtime_command(runtime, payload=payload)
    if runtime.authority_revision != current_authority_revision:
        _fail(
            409,
            "activity_authority_revision_stale",
            "Activity authority changed after this run was bound",
        )
    if runtime.release_revision != current_release_revision:
        _fail(
            409,
            "activity_release_revision_stale",
            "Activity release changed after this run was bound",
        )
    if existing.learner_sequence != command.run.sequence:
        _fail(
            409,
            "activity_runtime_learner_sequence_conflict",
            "Replayed learner sequence does not match the persisted fact",
        )
    return _activity_runtime_receipt(
        existing,
        runtime=runtime,
        status="reconciled",
    )


def _activity_runtime_receipt(
    event: LearningEvidenceEvent,
    *,
    runtime: LearningActivityRuntime,
    status: str,
) -> dict:
    return {
        "status": status,
        "client_event_id": event.client_event_id,
        "event_type": event.event_type,
        "run_id": runtime.run_id,
        "group_id": runtime.group_id,
        "learner_sequence": event.learner_sequence,
        "server_sequence": event.server_sequence,
        "server_last_sequence": runtime.last_server_sequence,
        "server_event_id": _activity_server_event_id(event.id),
    }


def _activity_recovery_unavailable(
    identity: LearningActivityRuntimeIdentity,
    *,
    reason: str,
    manual_intervention_required: bool,
) -> dict:
    return {
        "schema_version": LEARNING_ACTIVITY_SERVER_RECOVERY_SCHEMA,
        "consumer_schema_version": LEARNING_ACTIVITY_RECOVERY_SCHEMA,
        "exact_available": False,
        "manual_intervention_required": manual_intervention_required,
        "reason": reason,
        "snapshot_id": None,
        "captured_at": _activity_timestamp(utc_now()),
        "identity": identity.model_dump(mode="python"),
        "freshness": None,
        "server": None,
        "initial_snapshot_requirement": None,
        "client_pending_status": "unknown",
    }


def _activity_empty_server_recovery(
    identity: LearningActivityRuntimeIdentity,
    *,
    authority_revision: str,
    release_revision: str,
) -> dict:
    """Prove an empty server ledger without inventing domain state.

    The FE owner adapter must supply its canonical initial snapshot while
    assembling the frozen v2 outer bundle.  This response proves only that the
    exact server identity has no events; it says nothing about IndexedDB or the
    pedagogical correctness of an adapter-owned initial state.
    """

    identity_payload = identity.model_dump(mode="json")
    snapshot_id = "runtime-empty:" + _canonical_sha256(
        {
            "identity": identity_payload,
            "authority_revision": authority_revision,
            "release_revision": release_revision,
            "server_sequence": 0,
        }
    )[:32]
    return {
        "schema_version": LEARNING_ACTIVITY_SERVER_RECOVERY_SCHEMA,
        "consumer_schema_version": LEARNING_ACTIVITY_RECOVERY_SCHEMA,
        "exact_available": True,
        "manual_intervention_required": False,
        "reason": None,
        "snapshot_id": snapshot_id,
        "captured_at": _activity_timestamp(utc_now()),
        "identity": identity_payload,
        "freshness": {
            "status": "current",
            "authority_revision": authority_revision,
            "release_revision": release_revision,
        },
        "server": {
            "identity": identity_payload,
            "complete_history": True,
            "event_count": 0,
            "events": [],
            "projection": {
                "state": "not_started",
                "applied_through_server_sequence": 0,
                "completion_witness": None,
            },
            "snapshot": None,
        },
        "initial_snapshot_requirement": {
            "source": "owner-adapter-canonical-initial-snapshot",
            "state_schema_version_source": (
                "manifest.content.state_schema_version"
            ),
            "applied_through_learner_sequence": 0,
            "server_domain_state_verified": False,
        },
        "client_pending_status": "unknown",
    }


def _activity_runtime_history_invalid_reason(
    db: Session,
    *,
    runtime: LearningActivityRuntime,
    events: list[LearningEvidenceEvent],
) -> str | None:
    if (
        runtime.last_learner_sequence <= 0
        or runtime.last_server_sequence != len(events)
        or runtime.last_server_sequence < runtime.last_learner_sequence
        or runtime.snapshot_applied_through_learner_sequence
        != runtime.last_learner_sequence
        or not isinstance(runtime.snapshot_json, dict)
    ):
        return "activity_snapshot_incomplete"
    client_event_ids: set[str] = set()
    event_ids = {event.id for event in events}
    expected_learner_sequence = 0
    latest_learner_sidecar = None
    for expected_server_sequence, event in enumerate(events, start=1):
        if (
            event.server_sequence != expected_server_sequence
            or event.activity_runtime_id != runtime.id
            or event.subject_user_id != runtime.subject_user_id
            or event.class_id != runtime.class_id
            or event.course_id != runtime.course_id
            or event.course_unit_id != runtime.course_unit_id
            or event.activity_key != runtime.activity_key
            or event.rule_id != runtime.rule_id
            or event.rule_version != runtime.rule_version
            or event.event_schema_version != runtime.event_schema_version
        ):
            return "activity_history_identity_or_sequence_invalid"
        if event.client_event_id in client_event_ids:
            return "activity_history_client_event_duplicate"
        client_event_ids.add(event.client_event_id)
        if event.producer_type == "learner":
            expected_learner_sequence += 1
            if event.event_type not in {
                "started",
                "predicted",
                "attempted",
                "corrected",
                "explained",
            } or event.source_event_ids_json:
                return "activity_history_learner_fact_invalid"
            if (
                event.actor_user_id != runtime.subject_user_id
                or event.learner_sequence != expected_learner_sequence
                or not isinstance(event.activity_sidecar_json, dict)
                or not isinstance(event.activity_sidecar_sha256, str)
            ):
                return "activity_history_learner_cursor_or_sidecar_invalid"
            try:
                sidecar = LearningActivityRuntimeEventCreate.model_validate(
                    event.activity_sidecar_json
                )
            except ValidationError:
                return "activity_history_sidecar_schema_invalid"
            canonical_sidecar = sidecar.model_dump(mode="json")
            command = sidecar.command
            if (
                canonical_sidecar != event.activity_sidecar_json
                or _canonical_sha256(canonical_sidecar)
                != event.activity_sidecar_sha256
                or _event_request_hash(
                    actor_user_id=event.actor_user_id,
                    subject_user_id=event.subject_user_id,
                    producer_type="learner",
                    payload=canonical_sidecar,
                )
                != event.request_sha256
            ):
                return "activity_history_sidecar_hash_invalid"
            if (
                command.client_event_id != event.client_event_id
                or command.event_type != event.event_type
                or command.evidence != event.evidence_json
                or command.run.sequence != event.learner_sequence
                or command.run.run_id != runtime.run_id
                or command.run.group_id != runtime.group_id
                or command.scope.class_id != runtime.class_id
                or command.scope.course_id != runtime.course_id
                or command.scope.course_unit_id != runtime.course_unit_id
                or command.scope.activity_key != runtime.activity_key
                or command.versions.manifest_version != runtime.manifest_version
                or command.versions.content_version != runtime.content_version
                or command.versions.event_schema_version
                != runtime.event_schema_version
                or command.versions.rule_version != runtime.rule_version
                or command.versions.generation != runtime.generation
                or sidecar.snapshot.state_schema_version
                != runtime.state_schema_version
                or sidecar.snapshot.applied_through_learner_sequence
                != event.learner_sequence
                or _as_utc(event.occurred_at)
                != _parse_activity_timestamp(command.occurred_at)
            ):
                return "activity_history_sidecar_fact_mismatch"
            latest_learner_sidecar = sidecar
        elif event.producer_type in {"rule", "trusted_assessment"}:
            if (
                event.event_type not in {"completed", "transferred"}
                or event.learner_sequence is not None
                or event.activity_sidecar_json is not None
                or event.activity_sidecar_sha256 is not None
            ):
                return "activity_history_derived_fact_invalid"
        else:
            return "activity_history_producer_invalid"
    if (
        expected_learner_sequence != runtime.last_learner_sequence
        or latest_learner_sidecar is None
        or runtime.state_schema_version
        != latest_learner_sidecar.snapshot.state_schema_version
        or runtime.snapshot_applied_through_learner_sequence
        != latest_learner_sidecar.snapshot.applied_through_learner_sequence
        or runtime.snapshot_json != latest_learner_sidecar.snapshot.data
    ):
        return "activity_snapshot_incomplete"
    if event_ids:
        correction = db.scalar(
            select(LearningEvidenceEvent.id).where(
                LearningEvidenceEvent.corrects_event_id.in_(event_ids)
            ).limit(1)
        )
        if correction is not None:
            return "activity_history_administratively_corrected"
    return None


def _activity_runtime_terminal_projection(
    *,
    runtime: LearningActivityRuntime,
    events: list[LearningEvidenceEvent],
    identity: LearningActivityRuntimeIdentity,
) -> tuple[str, dict | None]:
    transferred = [event for event in events if event.event_type == "transferred"]
    completed = [event for event in events if event.event_type == "completed"]
    terminal_events = transferred or completed
    if not terminal_events:
        return (
            "in_progress"
            if any(event.producer_type == "learner" for event in events)
            else "not_started",
            None,
        )
    if len(terminal_events) != 1:
        return terminal_events[0].event_type, None
    derived = terminal_events[0]
    if derived.producer_type != "rule":
        return derived.event_type, None
    source_ids = [int(value) for value in (derived.source_event_ids_json or [])]
    if (
        not source_ids
        or len(source_ids) != len(set(source_ids))
        or len(source_ids) > MAX_RULE_WITNESS_EVENTS
        or derived.server_sequence is None
        or derived.learner_sequence is not None
    ):
        return derived.event_type, None
    by_id = {event.id: event for event in events}
    sources = [by_id.get(source_id) for source_id in source_ids]
    if any(
        source is None
        or source.producer_type != "learner"
        or source.activity_runtime_id != runtime.id
        or source.server_sequence is None
        or source.learner_sequence is None
        or source.server_sequence >= derived.server_sequence
        for source in sources
    ):
        return derived.event_type, None
    return derived.event_type, {
        "identity": identity.model_dump(mode="python"),
        "projection_state": derived.event_type,
        "rule_version": runtime.rule_version,
        "applied_through_server_sequence": runtime.last_server_sequence,
        "derived_server_event_id": _activity_server_event_id(derived.id),
        "derived_server_sequence": derived.server_sequence,
        "source_client_event_ids": [source.client_event_id for source in sources],
    }
