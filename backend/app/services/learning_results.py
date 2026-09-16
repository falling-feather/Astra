"""One result index over immutable assessment/evidence facts and recognition links."""
from dataclasses import dataclass
from datetime import datetime
from sqlalchemy import and_, exists, func, or_, select, union_all
from sqlalchemy.orm import Session, aliased

from app.db.json_membership import JsonArrayHasInteger
from app.models import AssignmentAttempt, AssignmentGrade, CheckpointAttempt, Course, CourseCandidate, CourseChangeBatch, CourseClass, CourseRelease, CourseReleaseUnit, LearningActivityProjection, LearningContext, LearningEvidenceEvent, LearningResult, LearningResultRecognition


def valid_outcome_event(event_id):
    outcome, correction = aliased(LearningEvidenceEvent), aliased(LearningEvidenceEvent)
    invalid = exists(select(correction.id).where(
        correction.event_type == "administrative_correction",
        or_(correction.corrects_event_id == outcome.id, JsonArrayHasInteger(outcome.source_event_ids_json, correction.corrects_event_id)),
    ).correlate(outcome))
    return or_(event_id.is_(None), exists(select(outcome.id).where(outcome.id == event_id, ~invalid).correlate(LearningResult)))


def valid_result_condition():
    grade, later_grade = aliased(AssignmentGrade), aliased(AssignmentGrade)
    attempt, later_attempt = aliased(AssignmentAttempt), aliased(AssignmentAttempt)
    latest_grade = ~exists(select(later_grade.id).where(later_grade.attempt_id == grade.attempt_id, later_grade.revision > grade.revision).correlate(grade))
    latest_attempt = ~exists(select(later_attempt.id).where(later_attempt.submission_id == attempt.submission_id, func.coalesce(later_attempt.course_release_id, 0) == func.coalesce(attempt.course_release_id, 0), later_attempt.attempt_number > attempt.attempt_number).correlate(attempt))
    grade_valid = or_(LearningResult.assignment_grade_id.is_(None), exists(select(grade.id).join(attempt, attempt.id == grade.attempt_id).where(grade.id == LearningResult.assignment_grade_id, latest_grade, latest_attempt).correlate(LearningResult)))
    event_id = func.coalesce(LearningResult.completion_event_id, LearningResult.evidence_event_id)
    return and_(grade_valid, valid_outcome_event(event_id))


def result_credits():
    """Facts are counted in their release, or in a release explicitly recognizing them."""
    result = LearningResult
    direct = select(result.id.label("result_id"), result.course_id, result.course_unit_id, result.student_id, result.class_id, result.course_release_id.label("release_id")).where(result.course_release_id.is_not(None), result.completed.is_(True), valid_result_condition())
    recognition = LearningResultRecognition
    carried = select(result.id.label("result_id"), result.course_id, result.course_unit_id, result.student_id, recognition.target_class_id.label("class_id"), recognition.target_release_id.label("release_id")).join(recognition, recognition.result_id == result.id).join(CourseRelease, CourseRelease.id == recognition.target_release_id).where(CourseRelease.course_id == result.course_id, recognition.course_unit_id == result.course_unit_id, recognition.student_id == result.student_id, recognition.completed.is_(True), valid_result_condition())
    return union_all(direct, carried).subquery("versioned_result_credits")


def completed_units_for_release(db: Session, *, release_id: int, student_id: int, class_id: int) -> set[int]:
    credit = result_credits()
    return set(db.scalars(select(credit.c.course_unit_id).where(credit.c.release_id == release_id, credit.c.student_id == student_id, credit.c.class_id == class_id).distinct()))


def pinned_completed_units(db: Session, *, release: CourseRelease, student_id: int, class_id: int) -> set[int]:
    if release.result_contract_version == 2:
        return completed_units_for_release(db, release_id=release.id, student_id=student_id, class_id=class_id)
    return set(db.scalars(select(LearningActivityProjection.course_unit_id).where(LearningActivityProjection.course_id == release.course_id, LearningActivityProjection.subject_user_id == student_id, LearningActivityProjection.class_id == class_id, LearningActivityProjection.rule_id == release.completion_rule_id, LearningActivityProjection.status.in_(["completed", "transferred"]))))


@dataclass(frozen=True)
class ActivityProgressView:
    status: str
    last_occurred_at: datetime | None


def progress_views(db: Session, *, release: CourseRelease, subjects: set[int], class_id: int) -> dict[tuple[int, int], ActivityProgressView]:
    """Read model only: never mutate the old projection to imitate a newer version."""
    if not subjects:
        return {}
    credit = result_credits()
    completed = {(row.student_id, row.course_unit_id) for row in db.execute(select(credit.c.student_id, credit.c.course_unit_id).where(credit.c.release_id == release.id, credit.c.class_id == class_id, credit.c.student_id.in_(subjects)).distinct())}
    facts = select(LearningResult.student_id, LearningResult.course_unit_id, LearningResult.occurred_at.label("time")).where(LearningResult.course_release_id == release.id, LearningResult.class_id == class_id, LearningResult.student_id.in_(subjects))
    starts = select(LearningContext.user_id.label("student_id"), LearningContext.course_unit_id, LearningContext.created_at.label("time")).where(LearningContext.course_release_id == release.id, LearningContext.class_id == class_id, LearningContext.user_id.in_(subjects), LearningContext.mode == "formal")
    activity = union_all(facts, starts).subquery()
    times = {(row.student_id, row.course_unit_id): row.time for row in db.execute(select(activity.c.student_id, activity.c.course_unit_id, func.max(activity.c.time).label("time")).group_by(activity.c.student_id, activity.c.course_unit_id))}
    return {key: ActivityProgressView("completed" if key in completed else "in_progress", times.get(key)) for key in completed | set(times)}


def record_checkpoint_result(db: Session, attempt: CheckpointAttempt, context: LearningContext, event: LearningEvidenceEvent | None) -> LearningResult:
    existing = db.scalar(select(LearningResult).where(LearningResult.checkpoint_attempt_id == attempt.id))
    if existing is not None:
        return existing
    result = LearningResult(student_id=attempt.student_id, school_id=context.school_id, class_id=attempt.class_id, course_id=attempt.course_id, course_unit_id=attempt.course_unit_id, course_release_id=attempt.course_release_id, context_id=context.id, checkpoint_attempt_id=attempt.id, completion_event_id=event.id if event else None, completed=attempt.is_correct and attempt.completion_eligible, provenance="server-checkpoint", occurred_at=attempt.submitted_at)
    db.add(result)
    db.flush()
    carry_late_result(db, result)
    return result


def _recognize(db: Session, result: LearningResult, release: CourseRelease, candidate: CourseCandidate, class_id: int, existing: set[int], *, actor_id: int, basis: dict) -> None:
    if result.id in existing:
        return
    db.add(LearningResultRecognition(result_id=result.id, target_release_id=release.id, course_unit_id=result.course_unit_id, student_id=result.student_id, target_class_id=class_id, candidate_id=candidate.id, authorized_by_user_id=actor_id, completed=True, basis_json=basis))
    existing.add(result.id)


def _index_legacy_outcomes(db: Session, course: Course, base: CourseRelease | None, unit_ids: set[int], class_id: int) -> None:
    event, projection = LearningEvidenceEvent, LearningActivityProjection
    statement = select(event).join(projection, and_(projection.subject_user_id == event.subject_user_id, projection.class_id == event.class_id, projection.course_id == event.course_id, projection.course_unit_id == event.course_unit_id, projection.rule_id == event.rule_id)).where(event.course_id == course.id, event.course_unit_id.in_(unit_ids), event.event_type.in_(["completed", "transferred"]), event.producer_type.in_(["rule", "trusted_assessment"]), projection.status.in_(["completed", "transferred"]), ~event.client_event_id.like("@assessment:checkpoint:%"))
    if base is not None:
        statement = statement.where(event.rule_id == base.completion_rule_id, event.class_id == class_id)
    events = list(db.scalars(statement))
    event_ids = [event.id for event in events]
    known = set(db.scalars(select(LearningResult.evidence_event_id).where(LearningResult.evidence_event_id.in_(event_ids))))
    known.update(db.scalars(select(LearningResult.completion_event_id).where(LearningResult.completion_event_id.in_(event_ids))))
    for source in events:
        if source.id not in known:
            db.add(LearningResult(student_id=source.subject_user_id, school_id=source.school_id, class_id=source.class_id, course_id=source.course_id, course_unit_id=source.course_unit_id, course_release_id=None, context_id=None, evidence_event_id=source.id, completed=True, provenance="legacy-rule-fact", occurred_at=source.occurred_at))
    db.flush()


def legacy_effective_results(db: Session, *, course: Course, base: CourseRelease | None, unit_ids: set[int], class_id: int) -> list[LearningResult]:
    _index_legacy_outcomes(db, course, base, unit_ids, class_id)
    projection = LearningActivityProjection
    source_rule = func.coalesce(CheckpointAttempt.rule_id, LearningEvidenceEvent.rule_id)
    statement = select(LearningResult).outerjoin(CheckpointAttempt, CheckpointAttempt.id == LearningResult.checkpoint_attempt_id).outerjoin(LearningEvidenceEvent, LearningEvidenceEvent.id == LearningResult.evidence_event_id).join(projection, and_(projection.subject_user_id == LearningResult.student_id, projection.class_id == LearningResult.class_id, projection.course_id == LearningResult.course_id, projection.course_unit_id == LearningResult.course_unit_id, projection.rule_id == source_rule)).where(LearningResult.course_id == course.id, LearningResult.course_unit_id.in_(unit_ids), LearningResult.completed.is_(True), projection.status.in_(["completed", "transferred"]), valid_result_condition())
    if base is not None:
        statement = statement.where(source_rule == base.completion_rule_id, LearningResult.class_id == class_id)
    return list(db.scalars(statement).unique())


def recognize_publication_results(db: Session, *, course: Course, release: CourseRelease, course_class: CourseClass) -> None:
    candidate = db.get(CourseCandidate, release.candidate_id)
    keep = {int(key) for key, value in candidate.result_policy_json.items() if value == "keep"}
    if not keep:
        return
    base = db.get(CourseRelease, candidate.base_release_id) if candidate.base_release_id else None
    credit = result_credits()
    results = [] if base is None else list(db.scalars(select(LearningResult).where(LearningResult.id.in_(select(credit.c.result_id).where(credit.c.release_id == base.id)), LearningResult.course_unit_id.in_(keep))))
    if base is None or base.result_contract_version == 1:
        results.extend(legacy_effective_results(db, course=course, base=base, unit_ids=keep, class_id=course_class.class_id))
    existing = set(db.scalars(select(LearningResultRecognition.result_id).where(LearningResultRecognition.target_release_id == release.id)))
    actor_id = db.get(CourseChangeBatch, candidate.batch_id).created_by_user_id
    for result in results:
        _recognize(db, result, release, candidate, course_class.class_id, existing, actor_id=actor_id, basis={"policy": "keep", "base_release_id": candidate.base_release_id, "source_release_id": result.course_release_id, "source_provenance": result.provenance})
    db.flush()


def carry_late_result(db: Session, result: LearningResult) -> None:
    """An older running context may finish later, but never crosses a redo barrier."""
    if not result.completed or result.course_release_id is None:
        return
    source = db.get(CourseRelease, result.course_release_id)
    later = list(db.scalars(select(CourseRelease).where(CourseRelease.course_id == result.course_id, CourseRelease.release_number > source.release_number).order_by(CourseRelease.release_number)))
    if not later:
        return
    from app.services.content_platform import _internal_course_class
    course_class = _internal_course_class(db, result.course_id, locking_read=True)
    for release in later:
        candidate = db.get(CourseCandidate, release.candidate_id) if release.candidate_id else None
        if candidate is None or candidate.result_policy_json.get(str(result.course_unit_id)) != "keep":
            break
        present = db.scalar(select(CourseReleaseUnit.id).where(CourseReleaseUnit.course_release_id == release.id, CourseReleaseUnit.source_course_unit_id == result.course_unit_id))
        if present is None:
            break
        existing = set(db.scalars(select(LearningResultRecognition.result_id).where(LearningResultRecognition.target_release_id == release.id, LearningResultRecognition.result_id == result.id)))
        actor_id = db.get(CourseChangeBatch, candidate.batch_id).created_by_user_id
        _recognize(db, result, release, candidate, course_class.class_id, existing, actor_id=actor_id, basis={"policy": "keep", "source_release_id": result.course_release_id, "finished_after_publication": True})
    db.flush()
