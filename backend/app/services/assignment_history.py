"""Append-only homework attempts and grades; Submission is a compatibility head."""
from copy import deepcopy
from uuid import uuid4

from fastapi import HTTPException, Request
from pydantic import ValidationError
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.learning_evidence_contract import as_utc, canonical_sha256
from app.models import Assignment, AssignmentAttempt, AssignmentGrade, ContentPageVersion, Course, CourseCandidate, CourseRelease, CourseReleaseUnit, CourseUnit, LearningCompletionRule, LearningContext, LearningEvent, LearningResult, PointLedger, Submission, User
from app.models.base import utc_now
from app.schemas.learning_history import AssignmentAttemptCommand, AssignmentGradeCommand, LearningContextStart
from app.services.access_control import course_attached_to_class, get_class, lock_active_class_for_write, lock_course_for_write, lock_scope_eligible_user, require_class_teacher_or_admin, require_course_editor_or_admin, require_course_visible, require_school_role, require_student_unit_published
from app.services.assignment_policies import resolve_assignment_class_policy
from app.services.audit import record_audit_log
from app.services.course_completion import _trusted_completion_event
from app.services.course_release_write_gate import require_student_unit_open_for_write
from app.services.course_snapshots import latest_release
from app.services.learning_contexts import assignment_access, read_context, require_context, start_context
from app.services.learning_evidence_projection import rebuild_activity_projection, scope_from_event
from app.services.learning_results import carry_late_result
from app.services.points import assignment_grade_point_total, normalize_assignment_point_rule, points_for_assignment_score


def assignment_scope(db: Session, assignment_id: int):
    assignment = db.get(Assignment, assignment_id)
    unit = db.get(CourseUnit, assignment.unit_id) if assignment else None
    course = db.get(Course, unit.course_id) if unit else None
    if not assignment or not unit or not course:
        raise HTTPException(status_code=404, detail="作业或所属课程不存在")
    return assignment, unit, course


def _legacy_definition(assignment: Assignment, policy) -> dict:
    return {"id": assignment.id, "unit_id": assignment.unit_id, "title": assignment.title, "description": assignment.description, "max_score": assignment.max_score, "point_rule": deepcopy(policy.point_rule), "definition_origin": "legacy_task_at_submission"}


def legacy_student_scope(db: Session, *, actor: User, course: Course, unit: CourseUnit, class_id: int):
    if actor.role != "student" or actor.status != "active":
        raise HTTPException(status_code=403, detail="仅当前有效学生可以提交作业")
    course = lock_course_for_write(db, course.id)
    lock_scope_eligible_user(db, actor.id, "student", status_code=403)
    require_course_visible(db, actor, course.id)
    require_student_unit_published(actor, unit)
    group = get_class(db, class_id)
    if group.school_id != course.school_id or not course_attached_to_class(db, course.id, class_id):
        raise HTTPException(status_code=403, detail="班级不在这门课程的教学范围内")
    return require_student_unit_open_for_write(db, course=course, class_group=group, unit=unit, student_id=actor.id)


def teacher_scope(db: Session, *, actor: User, submission: Submission, write: bool):
    assignment, unit, course = assignment_scope(db, submission.assignment_id)
    if actor.role not in {"teacher", "admin"} or actor.status != "active":
        raise HTTPException(status_code=403, detail="需要当前有效教学权限")
    if submission.class_id is None:
        raise HTTPException(status_code=409, detail="旧提交缺少可核实的教学范围，请先核对数据")
    if write:
        course = lock_course_for_write(db, course.id)
        lock_scope_eligible_user(db, actor.id, "teacher", status_code=403)
        group = lock_active_class_for_write(db, submission.class_id, expected_school_id=course.school_id)
        if course.status == "archived":
            raise HTTPException(status_code=409, detail="请先恢复课程再修改评价")
    else:
        group = get_class(db, submission.class_id)
    require_school_role(db, actor, course.school_id, {"admin", "teacher"})
    if group.school_id != course.school_id:
        raise HTTPException(status_code=403, detail="提交不属于该学校")
    if group.kind == "course_cohort":
        require_course_editor_or_admin(db, actor, course)
    else:
        require_class_teacher_or_admin(db, actor, group)
    return assignment, unit, course, group


def attempt_read(db: Session, attempt: AssignmentAttempt) -> dict:
    release = db.get(CourseRelease, attempt.course_release_id) if attempt.course_release_id else None
    context = db.get(LearningContext, attempt.context_id) if attempt.context_id else None
    return {"id": attempt.id, "submission_id": attempt.submission_id, "submission_revision": attempt.submission_revision, "assignment_id": attempt.assignment_id, "student_id": attempt.student_id, "class_id": attempt.class_id, "course_id": attempt.course_id, "course_unit_id": attempt.course_unit_id, "course_release_id": attempt.course_release_id, "release_number": release.release_number if release else None, "context_key": context.context_key if context else None, "attempt_number": attempt.attempt_number, "content": deepcopy(attempt.content_json), "assignment_snapshot": deepcopy(attempt.assignment_snapshot_json), "provenance": attempt.provenance, "submitted_at": as_utc(attempt.submitted_at)}


def grade_read(grade: AssignmentGrade) -> dict:
    return {"id": grade.id, "attempt_id": grade.attempt_id, "revision": grade.revision, "submission_revision": grade.submission_revision, "status": grade.status, "score": grade.score, "max_score": grade.max_score, "feedback": grade.feedback, "graded_by_user_id": grade.graded_by_user_id, "graded_at": as_utc(grade.graded_at) if grade.graded_at else None, "recorded_at": as_utc(grade.recorded_at), "feedback_retained": grade.feedback_retained, "provenance": grade.provenance, "point_delta": grade.point_delta}


def can_submit_again(db: Session, submission: Submission, context: LearningContext | None) -> bool:
    if context is None:
        return submission.status == "returned"
    same_version = db.scalar(select(AssignmentAttempt).where(AssignmentAttempt.submission_id == submission.id, AssignmentAttempt.course_release_id == context.course_release_id).order_by(AssignmentAttempt.attempt_number.desc()).limit(1))
    if same_version:
        grade = db.scalar(select(AssignmentGrade).where(AssignmentGrade.attempt_id == same_version.id).order_by(AssignmentGrade.revision.desc()).limit(1))
        return bool(grade and grade.status == "returned")
    if not submission.current_attempt_id:
        return False
    previous = db.get(AssignmentAttempt, submission.current_attempt_id)
    if previous is None or previous.course_release_id == context.course_release_id:
        return False
    old_release = db.get(CourseRelease, previous.course_release_id) if previous.course_release_id else None
    target = db.get(CourseRelease, context.course_release_id)
    if old_release and old_release.release_number > target.release_number:
        # This server-registered older context can finish, but it will not
        # replace a newer version's compatibility head.
        return True
    if submission.status == "returned":
        return True
    statement = select(CourseCandidate.result_policy_json).join(CourseRelease, CourseRelease.candidate_id == CourseCandidate.id).where(CourseRelease.course_id == context.course_id, CourseRelease.release_number <= target.release_number)
    if old_release:
        statement = statement.where(CourseRelease.release_number > old_release.release_number)
    return any(policy.get(str(context.course_unit_id)) == "redo" for policy in db.scalars(statement))


def _becomes_current(db: Session, submission: Submission, context: LearningContext | None) -> bool:
    if context is None or not submission.current_attempt_id:
        return True
    old = db.get(AssignmentAttempt, submission.current_attempt_id)
    if old is None or old.course_release_id is None:
        return True
    old_release = db.get(CourseRelease, old.course_release_id)
    new_release = db.get(CourseRelease, context.course_release_id)
    return old_release.release_number <= new_release.release_number


def submit_attempt(db: Session, *, actor: User, assignment_id: int, payload: AssignmentAttemptCommand, request: Request | None = None) -> dict:
    assignment, unit, course = assignment_scope(db, assignment_id)
    context, scope = None, None
    if payload.context_key:
        context, scope = require_context(db, actor=actor, context_key=payload.context_key, write=True)
        if context.mode != "formal" or context.assignment_id != assignment_id or context.course_unit_id != unit.id:
            raise HTTPException(status_code=403, detail="学习入口与这份作业不一致")
        if payload.class_id is not None and payload.class_id != context.class_id:
            raise HTTPException(status_code=403, detail="不能更换已经确认的教学范围")
        group = scope["class_group"]
        definition = deepcopy(context.assignment_snapshot_json)
        assignment_access(db, scope, assignment_id, write=True)
    else:
        if latest_release(db, course.id) is not None:
            raise HTTPException(status_code=409, detail="请先从课程发布版打开这份作业，再提交回答")
        if payload.class_id is None:
            raise HTTPException(status_code=422, detail="旧授课作业需要明确班级")
        group = legacy_student_scope(db, actor=actor, course=course, unit=unit, class_id=payload.class_id)
        effective = resolve_assignment_class_policy(db, assignment, group.id, locking_read=True)
        if not effective.assigned:
            raise HTTPException(status_code=403, detail="作业不在该班级范围")
        if effective.status != "active":
            raise HTTPException(status_code=409, detail="作业当前不能提交")
        definition = _legacy_definition(assignment, effective)
        if payload.expected_assignment_sha256 and payload.expected_assignment_sha256 != canonical_sha256(definition):
            raise HTTPException(status_code=409, detail="作业要求或评分方式已经变化，请重新打开核对")
    command = {"assignment_id": assignment_id, **payload.model_dump(mode="json")}
    digest = canonical_sha256(command)
    existing = db.scalar(select(AssignmentAttempt).where(AssignmentAttempt.student_id == actor.id, AssignmentAttempt.client_request_id == payload.client_request_id))
    if existing:
        if existing.request_sha256 != digest:
            raise HTTPException(status_code=409, detail="本次提交编号已经对应其他回答")
        return attempt_read(db, existing)
    submission = db.scalar(select(Submission).where(Submission.assignment_id == assignment_id, Submission.student_id == actor.id, Submission.class_id == group.id).with_for_update().execution_options(populate_existing=True))
    revision = submission.revision if submission else 0
    if payload.expected_submission_revision != revision:
        raise HTTPException(status_code=409, detail="老师评阅或提交状态已更新，请重新读取后再交")
    if submission and not can_submit_again(db, submission, context):
        raise HTTPException(status_code=409, detail="这份作业已有提交；退回或明确要求新版补做后可再次提交")
    if submission and not submission.current_attempt_id:
        raise HTTPException(status_code=409, detail="旧提交尚未建立历史快照，请先完成迁移核对")
    becomes_current = submission is None or _becomes_current(db, submission, context)
    timestamp = utc_now()
    if submission is None:
        submission = Submission(assignment_id=assignment_id, student_id=actor.id, class_id=group.id, content=deepcopy(payload.content), status="submitted", submitted_at=timestamp, revision=1)
        db.add(submission)
        db.flush()
    else:
        changed = db.execute(update(Submission).where(Submission.id == submission.id, Submission.revision == revision).values(revision=revision + 1))
        if changed.rowcount != 1:
            raise HTTPException(status_code=409, detail="提交已变化，请重新读取")
        if becomes_current:
            submission.content, submission.status = deepcopy(payload.content), "submitted"
            submission.score = submission.feedback = submission.graded_by_user_id = submission.graded_at = None
            submission.current_grade_revision = 0
            submission.submitted_at = timestamp
    ordinal = (db.scalar(select(func.max(AssignmentAttempt.attempt_number)).where(AssignmentAttempt.submission_id == submission.id)) or 0) + 1
    attempt = AssignmentAttempt(submission_id=submission.id, assignment_id=assignment_id, student_id=actor.id, class_id=group.id, course_id=course.id, course_unit_id=unit.id, context_id=context.id if context else None, course_release_id=context.course_release_id if context else None, attempt_number=ordinal, submission_revision=revision + 1, client_request_id=payload.client_request_id, request_sha256=digest, content_json=deepcopy(payload.content), assignment_snapshot_json=definition, provenance="formal_submission" if context else "legacy_scope_submission", submitted_at=timestamp)
    db.add(attempt)
    db.flush()
    if becomes_current:
        submission.current_attempt_id = attempt.id
    db.add(LearningEvent(user_id=actor.id, school_id=course.school_id, class_id=group.id, course_id=course.id, unit_id=unit.id, assignment_id=assignment_id, event_type="submit", payload={"submission_id": submission.id, "attempt_id": attempt.id, "course_release_id": attempt.course_release_id}, occurred_at=timestamp))
    record_audit_log(db, actor=actor, action="submission.attempt.create", resource_type="assignment_attempt", resource_id=attempt.id, school_id=course.school_id, class_id=group.id, request=request, event_result="success", snapshot={"submission_id": submission.id, "attempt_number": ordinal, "course_release_id": attempt.course_release_id, "content_keys": sorted(payload.content)})
    response = attempt_read(db, attempt)
    db.commit()
    return response


def _completion_result(db: Session, *, actor: User, grade: AssignmentGrade, attempt: AssignmentAttempt, course: Course, unit: CourseUnit) -> LearningResult:
    release = db.get(CourseRelease, attempt.course_release_id) if attempt.course_release_id else None
    event, complete = None, False
    if release:
        frozen = db.scalar(select(CourseReleaseUnit).where(CourseReleaseUnit.course_release_id == release.id, CourseReleaseUnit.source_course_unit_id == unit.id))
        version = db.get(ContentPageVersion, frozen.content_page_version_id) if frozen else None
        if version is None:
            raise HTTPException(status_code=409, detail="提交对应的发布内容不完整")
        completion = (version.schema_json.get("courseUnit") or {}).get("completion") or {}
        preset = completion.get("preset")
        complete = completion.get("assignmentId") == attempt.assignment_id and (preset == "assignment_reviewed" or preset == "assignment_accepted" and grade.status == "graded")
        if complete:
            rule = db.get(LearningCompletionRule, release.completion_rule_id)
            if rule is None:
                raise HTTPException(status_code=409, detail="原完成规则不可用")
            event = _trusted_completion_event(client_event_id=f"@assessment:assignment-grade:{grade.id}", actor=actor, subject_user_id=attempt.student_id, school_id=course.school_id, class_id=attempt.class_id, course_id=course.id, unit=unit, rule=rule, assignment_id=attempt.assignment_id, evidence={"preset": preset, "assignment_id": attempt.assignment_id, "submission_id": attempt.submission_id, "assignment_attempt_id": attempt.id, "assignment_grade_id": grade.id, "course_release_id": release.id, "review_status": grade.status}, occurred_at=grade.graded_at)
            db.add(event)
            db.flush()
            rebuild_activity_projection(db, scope=scope_from_event(event), definition_json=rule.definition_json, locking_read=True)
    result = LearningResult(student_id=attempt.student_id, school_id=course.school_id, class_id=attempt.class_id, course_id=course.id, course_unit_id=unit.id, course_release_id=attempt.course_release_id, context_id=attempt.context_id, assignment_grade_id=grade.id, completion_event_id=event.id if event else None, completed=complete, provenance="teacher-grade", occurred_at=grade.graded_at)
    db.add(result)
    db.flush()
    carry_late_result(db, result)
    return result


def grade_attempt(db: Session, *, actor: User, attempt_id: int, payload: AssignmentGradeCommand, request: Request | None = None) -> dict:
    attempt = db.get(AssignmentAttempt, attempt_id)
    submission = db.get(Submission, attempt.submission_id) if attempt else None
    if attempt is None or submission is None:
        raise HTTPException(status_code=404, detail="提交记录不存在")
    assignment, unit, course, group = teacher_scope(db, actor=actor, submission=submission, write=True)
    command = {"attempt_id": attempt_id, **payload.model_dump(mode="json")}
    digest = canonical_sha256(command)
    existing = db.scalar(select(AssignmentGrade).where(AssignmentGrade.graded_by_user_id == actor.id, AssignmentGrade.client_request_id == payload.client_request_id))
    if existing:
        if existing.request_sha256 != digest:
            raise HTTPException(status_code=409, detail="这个评分编号已用于其他评价")
        return grade_read(existing)
    submission = db.scalar(select(Submission).where(Submission.id == submission.id).with_for_update().execution_options(populate_existing=True))
    if submission.revision != payload.expected_submission_revision:
        raise HTTPException(status_code=409, detail="学生提交或教师评分已变化，请先重新读取")
    is_current = submission.current_attempt_id == attempt_id
    if not is_current and not payload.allow_historical:
        raise HTTPException(status_code=409, detail="学生已经再次提交，请核对新稿；修改历史评分需要明确选择历史提交")
    latest = db.scalar(select(AssignmentGrade).where(AssignmentGrade.attempt_id == attempt_id).order_by(AssignmentGrade.revision.desc()).limit(1))
    if (latest.revision if latest else 0) != payload.expected_grade_revision:
        raise HTTPException(status_code=409, detail="这次提交已有更新的评分")
    maximum = attempt.assignment_snapshot_json.get("max_score")
    if not isinstance(maximum, int) or maximum < 0:
        raise HTTPException(status_code=409, detail="原作业满分不明确，不能推测新的评分基准")
    if payload.score is not None and payload.score > maximum:
        raise HTTPException(status_code=422, detail=f"分数不能超过这次提交的满分 {maximum}")
    timestamp = utc_now()
    point_delta = 0
    before = {"status": submission.status, "score": submission.score, "feedback": submission.feedback, "graded_by_user_id": submission.graded_by_user_id}
    changed = db.execute(update(Submission).where(Submission.id == submission.id, Submission.revision == payload.expected_submission_revision).values(revision=payload.expected_submission_revision + 1))
    if changed.rowcount != 1:
        raise HTTPException(status_code=409, detail="评价状态已被其他操作修改")
    if is_current:
        submission.status, submission.score, submission.feedback = payload.status, payload.score, payload.feedback
        submission.graded_by_user_id, submission.graded_at = actor.id, timestamp
        submission.current_grade_revision = (latest.revision if latest else 0) + 1
        rule = normalize_assignment_point_rule(attempt.assignment_snapshot_json.get("point_rule"))
        target_points = points_for_assignment_score(payload.score or 0, rule) if payload.status == "graded" else 0
        point_delta = target_points - assignment_grade_point_total(db, submission.id)
    grade = AssignmentGrade(attempt_id=attempt_id, revision=(latest.revision if latest else 0) + 1, status=payload.status, score=payload.score, max_score=maximum, feedback=payload.feedback, graded_by_user_id=actor.id, client_request_id=payload.client_request_id, request_sha256=digest, graded_at=timestamp, recorded_at=timestamp, provenance="teacher_evaluation", feedback_retained=True, submission_revision=submission.revision, point_delta=point_delta)
    db.add(grade)
    db.flush()
    if point_delta:
        db.add(PointLedger(user_id=attempt.student_id, school_id=course.school_id, class_id=attempt.class_id, assignment_id=assignment.id, submission_id=submission.id, delta=point_delta, reason="assignment_grade", note=payload.feedback, created_by_user_id=actor.id))
    result = _completion_result(db, actor=actor, grade=grade, attempt=attempt, course=course, unit=unit)
    record_audit_log(db, actor=actor, action="submission.grade", resource_type="submission", resource_id=submission.id, school_id=course.school_id, class_id=group.id, request=request, event_result="success", snapshot={"before": before, "after": {"attempt_id": attempt_id, "grade_id": grade.id, "result_id": result.id, "status": grade.status, "score": grade.score, "max_score": maximum, "feedback": grade.feedback, "graded_by_user_id": actor.id, "point_delta": point_delta, "historical": not is_current}})
    response = grade_read(grade)
    db.commit()
    return response


def submission_history(db: Session, *, actor: User, submission_id: int, limit: int = 20, offset: int = 0) -> dict:
    submission = db.get(Submission, submission_id)
    if submission is None:
        raise HTTPException(status_code=404, detail="提交记录不存在")
    if actor.role == "student":
        if submission.student_id != actor.id:
            raise HTTPException(status_code=403, detail="只能查看自己的作业记录")
    else:
        teacher_scope(db, actor=actor, submission=submission, write=False)
    statement = select(AssignmentAttempt).where(AssignmentAttempt.submission_id == submission_id)
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    attempts = list(db.scalars(statement.order_by(AssignmentAttempt.attempt_number.desc()).offset(offset).limit(limit)))
    grades = list(db.scalars(select(AssignmentGrade).where(AssignmentGrade.attempt_id.in_([attempt.id for attempt in attempts])).order_by(AssignmentGrade.attempt_id.desc(), AssignmentGrade.revision.desc())))
    return {"submission_id": submission_id, "revision": submission.revision, "current_attempt_id": submission.current_attempt_id, "attempts": [attempt_read(db, attempt) for attempt in attempts], "grades": [grade_read(grade) for grade in grades], "total": total, "offset": offset, "limit": limit, "next_offset": offset + len(attempts) if offset + len(attempts) < total else None}


def legacy_submit(db: Session, *, actor: User, assignment_id: int, payload, request: Request | None = None) -> Submission:
    if actor.role != "student" or actor.status != "active":
        raise HTTPException(status_code=403, detail="Only students can submit assignments")
    assignment, unit, course = assignment_scope(db, assignment_id)
    require_course_visible(db, actor, course.id)
    if latest_release(db, course.id) is not None and (not payload.context_key or payload.client_request_id is None or payload.expected_submission_revision is None):
        # A payload without a start/version coordinate cannot prove which task
        # the student saw; never silently attach it to the latest publication.
        raise HTTPException(status_code=409, detail={"code": "learning_context_required", "message": "请更新学习页面，从当前课程版本打开作业后提交"})
    existing = db.scalar(select(Submission).where(Submission.assignment_id == assignment_id, Submission.student_id == actor.id, Submission.class_id == payload.class_id))
    expected = payload.expected_submission_revision if payload.expected_submission_revision is not None else existing.revision if existing else 0
    command = _legacy_command(AssignmentAttemptCommand, client_request_id=payload.client_request_id or uuid4().hex, context_key=payload.context_key, class_id=payload.class_id, expected_submission_revision=expected, content=payload.content)
    result = submit_attempt(db, actor=actor, assignment_id=assignment_id, payload=command, request=request)
    return db.get(Submission, result["submission_id"])


def legacy_grade(db: Session, *, actor: User, submission_id: int, payload, request: Request | None = None) -> Submission:
    submission = db.get(Submission, submission_id)
    if submission is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    _, _, course, _ = teacher_scope(db, actor=actor, submission=submission, write=True)
    if not submission.current_attempt_id:
        raise HTTPException(status_code=409, detail="旧提交缺少历史快照，请先完成数据迁移核对")
    if course.workflow_generation == 2 and (payload.client_request_id is None or payload.expected_submission_revision is None or payload.expected_grade_revision is None):
        raise HTTPException(status_code=409, detail={"code": "grading_revision_required", "message": "请更新批改页面，核对这次提交和评分状态后再保存"})
    command = _legacy_command(AssignmentGradeCommand, client_request_id=payload.client_request_id or uuid4().hex, expected_submission_revision=payload.expected_submission_revision if payload.expected_submission_revision is not None else submission.revision, expected_grade_revision=payload.expected_grade_revision if payload.expected_grade_revision is not None else submission.current_grade_revision, score=payload.score, feedback=payload.feedback, status=payload.status)
    grade_attempt(db, actor=actor, attempt_id=submission.current_attempt_id, payload=command, request=request)
    db.refresh(submission)
    return submission


def _legacy_command(schema, **values):
    try:
        return schema.model_validate(values)
    except ValidationError as error:
        raise HTTPException(status_code=422, detail=error.errors(include_url=False)[0]["msg"]) from error


def open_assignment(db: Session, *, actor: User, assignment_id: int, payload) -> dict:
    assignment, unit, course = assignment_scope(db, assignment_id)
    if actor.role != "student" or actor.status != "active":
        raise HTTPException(status_code=403, detail="作业提交入口仅面向学生")
    existing = db.scalar(select(LearningContext).where(LearningContext.user_id == actor.id, LearningContext.client_request_id == payload.client_request_id))
    release = latest_release(db, course.id)
    if existing:
        if existing.mode != "formal" or existing.assignment_id != assignment_id:
            raise HTTPException(status_code=409, detail="本次打开编号已用于不同学习任务")
        context_data = read_context(db, actor=actor, context_key=existing.context_key)
    elif release:
        context_data = start_context(db, actor=actor, payload=LearningContextStart(client_request_id=payload.client_request_id, mode="formal", course_id=course.id, course_unit_id=unit.id, expected_release_id=release.id, assignment_id=assignment_id), commit=False)
    else:
        context_data = None
    if context_data:
        context, scope = require_context(db, actor=actor, context_key=context_data["context_key"])
        if payload.class_id is not None and payload.class_id != context.class_id:
            raise HTTPException(status_code=403, detail="作业不属于指定教学范围")
        group = scope["class_group"]
        _, policy = assignment_access(db, scope, assignment_id, write=False)
        definition = deepcopy(context.assignment_snapshot_json)
    else:
        if payload.class_id is None:
            raise HTTPException(status_code=422, detail="请指定旧作业的班级")
        context = None
        group = legacy_student_scope(db, actor=actor, course=course, unit=unit, class_id=payload.class_id)
        policy = resolve_assignment_class_policy(db, assignment, group.id)
        if not policy.assigned:
            raise HTTPException(status_code=403, detail="作业不在当前班级范围")
        definition = _legacy_definition(assignment, policy)
    submission = db.scalar(select(Submission).where(Submission.assignment_id == assignment_id, Submission.student_id == actor.id, Submission.class_id == group.id))
    attempt = None
    if submission:
        statement = select(AssignmentAttempt).where(AssignmentAttempt.submission_id == submission.id)
        if context:
            statement = statement.where(AssignmentAttempt.course_release_id == context.course_release_id)
        attempt = db.scalar(statement.order_by(AssignmentAttempt.attempt_number.desc()).limit(1))
    grade = db.scalar(select(AssignmentGrade).where(AssignmentGrade.attempt_id == attempt.id).order_by(AssignmentGrade.revision.desc()).limit(1)) if attempt else None
    reason = "作业已关闭，当前可回读已提交的内容" if policy.status != "active" else "已有提交，等待教师评阅或明确的补做安排" if submission and not can_submit_again(db, submission, context) else None
    response = {"assignment_id": assignment_id, "course_id": course.id, "course_unit_id": unit.id, "class_id": group.id, "context": context_data, "assignment": definition, "assignment_sha256": canonical_sha256(definition), "submission_id": submission.id if submission else None, "submission_revision": submission.revision if submission else 0, "attempt": attempt_read(db, attempt) if attempt else None, "grade": grade_read(grade) if grade else None, "can_submit": reason is None, "submit_block_reason": reason}
    db.commit()
    return response
