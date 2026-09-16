"""Own learning history stays readable without exposing unjoined course bodies."""
from copy import deepcopy

from fastapi import HTTPException
from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from app.core.learning_evidence_contract import as_utc
from app.models import AssignmentAttempt, AssignmentGrade, CheckpointAttempt, ClassGroup, ClassMembership, ContentPageVersion, Course, CourseClass, CourseEnrollment, CourseRelease, CourseReleaseUnit, LearningContext, LearningResult, School
from app.services.course_workflow_support import authoring_course
from app.services.course_snapshots import latest_release
from app.services.learning_results import pinned_completed_units, result_credits, valid_result_condition
from app.services.content_platform import _internal_course_class


def _history_reader(db: Session, actor, course_id: int, student_id: int | None) -> tuple[Course, int | None, bool]:
    course = db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=404, detail="课程不存在")
    if actor.role == "student":
        if student_id is not None and student_id != actor.id:
            raise HTTPException(status_code=403, detail="只能查看自己的学习记录")
        student_id = actor.id
        enrollment = db.scalar(select(CourseEnrollment).where(CourseEnrollment.course_id == course_id, CourseEnrollment.student_id == actor.id))
        own_fact = db.scalar(select(LearningResult.id).where(LearningResult.course_id == course_id, LearningResult.student_id == actor.id).limit(1))
        if enrollment is None and own_fact is None:
            raise HTTPException(status_code=404, detail="没有可读取的本人课程记录")
        active_scope = db.scalar(select(CourseClass.id).join(ClassGroup, ClassGroup.id == CourseClass.class_id).join(School, School.id == ClassGroup.school_id).join(ClassMembership, ClassMembership.class_id == ClassGroup.id).where(CourseClass.course_id == course_id, CourseClass.status == "active", ClassGroup.kind == "course_cohort", ClassGroup.status == "active", School.status == "active", ClassMembership.user_id == actor.id, ClassMembership.role == "student", ClassMembership.status == "active").limit(1))
        return course, student_id, bool(enrollment and enrollment.status == "active" and course.status == "published" and active_scope)
    authoring_course(db, actor, course_id)
    return course, student_id, True


def result_history(db: Session, *, actor, course_id: int, student_id: int | None = None, limit: int = 25, offset: int = 0) -> dict:
    course, student_id, allowed = _history_reader(db, actor, course_id, student_id)
    statement = select(LearningResult).where(LearningResult.course_id == course_id)
    if student_id is not None:
        statement = statement.where(LearningResult.student_id == student_id)
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = list(db.scalars(statement.order_by(LearningResult.occurred_at.desc(), LearningResult.id.desc()).offset(offset).limit(limit)))
    ids = {row.id for row in rows}
    valid = set(db.scalars(select(LearningResult.id).where(LearningResult.id.in_(ids), valid_result_condition())))
    checkpoints = {item.id: item for item in db.scalars(select(CheckpointAttempt).where(CheckpointAttempt.id.in_({row.checkpoint_attempt_id for row in rows if row.checkpoint_attempt_id})))}
    grades = {item.id: item for item in db.scalars(select(AssignmentGrade).where(AssignmentGrade.id.in_({row.assignment_grade_id for row in rows if row.assignment_grade_id})))}
    attempts = {item.id: item for item in db.scalars(select(AssignmentAttempt).where(AssignmentAttempt.id.in_({grade.attempt_id for grade in grades.values()})))}
    versions = {item.id: item for item in db.scalars(select(ContentPageVersion).where(ContentPageVersion.id.in_({item.content_page_version_id for item in checkpoints.values()})))}
    releases = {item.id: item for item in db.scalars(select(CourseRelease).where(CourseRelease.id.in_({row.course_release_id for row in rows if row.course_release_id})))}
    unit_titles = {(release_id, unit_id): title for release_id, unit_id, title in db.execute(select(CourseReleaseUnit.course_release_id, CourseReleaseUnit.source_course_unit_id, CourseReleaseUnit.title_snapshot).where(CourseReleaseUnit.course_release_id.in_(releases)))}
    current = latest_release(db, course_id)
    credit = result_credits()
    current_ids = set(db.scalars(select(credit.c.result_id).where(credit.c.release_id == current.id, credit.c.result_id.in_(ids)))) if current else set()
    items = []
    for row in rows:
        release = releases.get(row.course_release_id)
        item = {"result_id": row.id, "student_id": row.student_id, "course_unit_id": row.course_unit_id, "title": unit_titles.get((row.course_release_id, row.course_unit_id), f"历史学习单元 {row.course_unit_id}"), "kind": "activity", "source_release_id": row.course_release_id, "source_release_number": release.release_number if release else None, "current_credit": row.id in current_ids, "recognized": bool(current and row.id in current_ids and row.course_release_id != current.id), "valid": row.id in valid, "is_correct": None, "score": None, "max_score": None, "feedback": None, "feedback_retained": True, "response": {}, "prompt": None, "choices": [], "occurred_at": as_utc(row.occurred_at), "provenance": row.provenance}
        if row.checkpoint_attempt_id:
            attempt = checkpoints[row.checkpoint_attempt_id]
            version = versions.get(attempt.content_page_version_id)
            question = next((block for block in (version.schema_json if version else {}).get("blocks", []) if block.get("type") == "checkpoint" and block.get("checkpointKey") == attempt.checkpoint_key), {})
            item.update(kind="checkpoint", title=question.get("title") or item["title"], is_correct=attempt.is_correct, response=deepcopy(attempt.response_json), prompt=question.get("prompt"), choices=[{"choiceId": choice["choiceId"], "label": choice["label"]} for choice in question.get("choices", [])])
        elif row.assignment_grade_id:
            grade = grades[row.assignment_grade_id]
            attempt = attempts[grade.attempt_id]
            legacy = attempt.assignment_snapshot_json.get("definition_origin") == "migration_current_state"
            item.update(kind="assignment", title=f"旧作业 {attempt.assignment_id}" if legacy else attempt.assignment_snapshot_json.get("title") or item["title"], score=grade.score, max_score=grade.max_score, feedback=grade.feedback, feedback_retained=grade.feedback_retained, response=deepcopy(attempt.content_json), prompt=None if legacy else attempt.assignment_snapshot_json.get("description"))
        items.append(item)
    completed = []
    if current and student_id is not None and allowed:
        scope = _internal_course_class(db, course_id, locking_read=False)
        completed = sorted(pinned_completed_units(db, release=current, student_id=student_id, class_id=scope.class_id))
    return {"items": items, "total": total, "offset": offset, "limit": limit, "next_offset": offset + len(items) if offset + len(items) < total else None, "current_release_id": current.id if allowed and current else None, "current_release_number": current.release_number if allowed and current else None, "current_completed_units": completed, "can_read_course": allowed}


def recent_contexts(db: Session, *, actor, course_id: int, limit: int = 20) -> list[dict]:
    _, _, allowed = _history_reader(db, actor, course_id, actor.id)
    if actor.role != "student" or not allowed:
        return []
    current = latest_release(db, course_id)
    rows = db.execute(select(LearningContext, CourseRelease.release_number, CourseReleaseUnit.title_snapshot).join(CourseRelease, CourseRelease.id == LearningContext.course_release_id).join(CourseReleaseUnit, (CourseReleaseUnit.course_release_id == LearningContext.course_release_id) & (CourseReleaseUnit.source_course_unit_id == LearningContext.course_unit_id)).where(LearningContext.user_id == actor.id, LearningContext.course_id == course_id, LearningContext.mode == "formal", LearningContext.assignment_id.is_(None)).order_by(LearningContext.id.desc()).limit(limit))
    return [{"context_key": context.context_key, "course_id": course_id, "course_unit_id": context.course_unit_id, "course_release_id": context.course_release_id, "release_number": number, "unit_title": title, "created_at": as_utc(context.created_at), "is_current": bool(current and current.id == context.course_release_id)} for context, number, title in rows]
