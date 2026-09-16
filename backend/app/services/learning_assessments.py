"""Checkpoint evaluation against the version pinned when learning began."""
from fastapi import HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.learning_evidence_contract import canonical_sha256, learning_evidence_write_gate
from app.models import CheckpointAttempt, LearningContext, LearningResult
from app.models.base import utc_now
from app.schemas.content_platform import CheckpointAttemptCreate
from app.schemas.content_v2 import CheckpointBlock, ContentPageV2
from app.schemas.learning_history import ContextCheckpointAnswer, LearningContextStart
from app.services.audit import record_audit_log
from app.services.course_completion import _checkpoint_attempt_read, _grade_checkpoint, _matching_checkpoint_replay, _trusted_completion_event, _validated_checkpoint_response
from app.services.learning_contexts import formal_scope, require_context, start_context
from app.services.learning_evidence_projection import rebuild_activity_projection, scope_from_event
from app.services.learning_results import completed_units_for_release, record_checkpoint_result
from app.services.course_snapshots import latest_release


def answer_checkpoint(db: Session, *, actor, context_key: str, checkpoint_key: str, payload: ContextCheckpointAnswer, request: Request | None = None) -> dict:
    with learning_evidence_write_gate(db.get_bind().dialect.name):
        context, scope = require_context(db, actor=actor, context_key=context_key, write=True)
        if context.mode != "formal" or context.assignment_id is not None:
            raise HTTPException(status_code=403, detail="资源探索、教师预览和作业入口不提交课程检查点成绩")
        return _answer(db, actor=actor, context=context, scope=scope, checkpoint_key=checkpoint_key, payload=payload, request=request)


def _answer(db, *, actor, context, scope, checkpoint_key, payload, request):
    page = ContentPageV2.model_validate(scope["version"].schema_json)
    checkpoint = next((block for block in page.blocks if isinstance(block, CheckpointBlock) and block.checkpointKey == checkpoint_key), None)
    if checkpoint is None:
        raise HTTPException(status_code=404, detail="原发布版中没有这个检查点")
    if checkpoint.mode != "inline":
        raise HTTPException(status_code=422, detail="此题组需要专用评价入口")
    legacy_payload = CheckpointAttemptCreate.model_validate({**payload.model_dump(), "course_release_id": scope["release"].id})
    response = _validated_checkpoint_response(checkpoint, legacy_payload)
    digest = canonical_sha256({"student_id": actor.id, "course_id": scope["course"].id, "course_unit_id": scope["unit"].id, "course_release_id": scope["release"].id, "checkpoint_key": checkpoint_key, "response": response})
    attempt = db.scalar(select(CheckpointAttempt).where(CheckpointAttempt.client_attempt_id == payload.client_attempt_id).with_for_update())
    if attempt is not None:
        if not _matching_checkpoint_replay(attempt, actor=actor, unit=scope["unit"], release=scope["release"], checkpoint_key=checkpoint_key, request_sha256=digest):
            raise HTTPException(status_code=409, detail={"code": "checkpoint_attempt_id_conflict", "message": "本次回答编号已用于不同内容，请核对原结果"})
        result = db.scalar(select(LearningResult).where(LearningResult.checkpoint_attempt_id == attempt.id))
        return _response(db, context, attempt, result, checkpoint.maxAttempts, replayed=True)
    ordinal = (db.scalar(select(func.max(CheckpointAttempt.attempt_number)).where(CheckpointAttempt.course_release_id == scope["release"].id, CheckpointAttempt.course_unit_id == scope["unit"].id, CheckpointAttempt.student_id == actor.id, CheckpointAttempt.checkpoint_key == checkpoint_key)) or 0) + 1
    if checkpoint.maxAttempts is not None and ordinal > checkpoint.maxAttempts:
        raise HTTPException(status_code=409, detail={"code": "checkpoint_attempt_limit_reached", "message": "这个版本的检查点尝试次数已用完，请联系教师"})
    completion = page.courseUnit.completion if page.courseUnit else None
    eligible = completion is not None and completion.preset == "checkpoint_passed" and completion.checkpointKey == checkpoint_key
    correct = _grade_checkpoint(checkpoint, response)
    attempt = CheckpointAttempt(client_attempt_id=payload.client_attempt_id, request_sha256=digest, student_id=actor.id, class_id=context.class_id, course_id=context.course_id, course_unit_id=context.course_unit_id, course_release_id=context.course_release_id, content_page_version_id=scope["version"].id, checkpoint_key=checkpoint_key, rule_id=scope["rule"].id, rule_version=scope["rule"].version_number, attempt_number=ordinal, response_json=response, response_sha256=canonical_sha256(response), is_correct=correct, completion_eligible=eligible, learning_context_id=context.id, submitted_at=utc_now())
    db.add(attempt)
    db.flush()
    event = None
    if correct and eligible:
        event = _trusted_completion_event(client_event_id=f"@assessment:checkpoint:{attempt.id}", actor=actor, subject_user_id=actor.id, school_id=scope["course"].school_id, class_id=context.class_id, course_id=context.course_id, unit=scope["unit"], rule=scope["rule"], assignment_id=None, evidence={"preset": "checkpoint_passed", "checkpoint_key": checkpoint_key, "checkpoint_attempt_id": attempt.id, "course_release_id": context.course_release_id, "learning_context_id": context.id, "is_correct": True}, occurred_at=attempt.submitted_at)
        db.add(event)
        db.flush()
        rebuild_activity_projection(db, scope=scope_from_event(event), definition_json=scope["rule"].definition_json, locking_read=True)
    result = record_checkpoint_result(db, attempt, context, event)
    record_audit_log(db, actor=actor, action="course.checkpoint.attempt", resource_type="checkpoint_attempt", resource_id=attempt.id, school_id=scope["course"].school_id, class_id=context.class_id, request=request, event_result="success", snapshot={"course_id": context.course_id, "course_unit_id": context.course_unit_id, "course_release_id": context.course_release_id, "context_id": context.id, "attempt_number": ordinal, "is_correct": correct, "completion_eligible": eligible})
    answer = _response(db, context, attempt, result, checkpoint.maxAttempts, replayed=False)
    db.commit()
    return answer


def _response(db, context, attempt, result, max_attempts, *, replayed):
    if result is None:
        raise HTTPException(status_code=409, detail="这条旧回答缺少结果索引，请先完成数据迁移核对")
    current = latest_release(db, context.course_id)
    current_completed = bool(current and attempt.course_unit_id in completed_units_for_release(db, release_id=current.id, student_id=attempt.student_id, class_id=attempt.class_id))
    return {**_checkpoint_attempt_read(attempt, max_attempts=max_attempts, replayed=replayed), "context_key": context.context_key, "result_id": result.id, "current_version_completed": current_completed}


def answer_legacy_checkpoint(db: Session, *, actor, course_id: int, unit_id: int, checkpoint_key: str, payload: CheckpointAttemptCreate, request: Request | None = None) -> dict:
    """A legacy caller may start the current version, or replay its own stored answer."""
    with learning_evidence_write_gate(db.get_bind().dialect.name):
        existing = db.scalar(select(CheckpointAttempt).where(CheckpointAttempt.client_attempt_id == payload.client_attempt_id))
        if existing is not None and existing.student_id != actor.id:
            raise HTTPException(status_code=409, detail={"code": "checkpoint_attempt_id_conflict", "message": "回答编号已经被使用"})
        context = db.get(LearningContext, existing.learning_context_id) if existing and existing.learning_context_id else None
        if context is None:
            # Existing pre-context answers can be read after permission checks, but
            # an old release ID alone cannot authorize a new historical attempt.
            scope = formal_scope(db, actor=actor, course_id=course_id, unit_id=unit_id, release_id=payload.course_release_id, write=True)
            if existing is not None:
                page = ContentPageV2.model_validate(scope["version"].schema_json)
                checkpoint = next((block for block in page.blocks if isinstance(block, CheckpointBlock) and block.checkpointKey == checkpoint_key), None)
                if checkpoint is None:
                    raise HTTPException(status_code=404, detail="检查点不存在")
                response = _validated_checkpoint_response(checkpoint, payload)
                digest = canonical_sha256({"student_id": actor.id, "course_id": course_id, "course_unit_id": unit_id, "course_release_id": payload.course_release_id, "checkpoint_key": checkpoint_key, "response": response})
                if not _matching_checkpoint_replay(existing, actor=actor, unit=scope["unit"], release=scope["release"], checkpoint_key=checkpoint_key, request_sha256=digest):
                    raise HTTPException(status_code=409, detail={"code": "checkpoint_attempt_id_conflict", "message": "原回答与这次请求不一致"})
                return _checkpoint_attempt_read(existing, max_attempts=checkpoint.maxAttempts, replayed=True)
            current = latest_release(db, course_id)
            if current is None or current.id != payload.course_release_id:
                raise HTTPException(status_code=409, detail={"code": "course_release_stale", "message": "这个旧页面尚未登记学习上下文，请重新进入当前课程版本"})
            opened = start_context(db, actor=actor, payload=LearningContextStart(client_request_id=f"checkpoint:{canonical_sha256(payload.client_attempt_id)}", mode="formal", course_id=course_id, course_unit_id=unit_id, expected_release_id=payload.course_release_id), commit=False)
            context = db.scalar(select(LearningContext).where(LearningContext.context_key == opened["context_key"]))
        if (context.course_id, context.course_unit_id, context.course_release_id) != (course_id, unit_id, payload.course_release_id):
            raise HTTPException(status_code=409, detail="回答对应的课程身份不一致")
        answer = ContextCheckpointAnswer.model_validate(payload.model_dump(exclude={"course_release_id"}))
        _, scope = require_context(db, actor=actor, context_key=context.context_key, write=True)
        response = _answer(db, actor=actor, context=context, scope=scope, checkpoint_key=checkpoint_key, payload=answer, request=request)
        return {key: value for key, value in response.items() if key not in {"context_key", "result_id", "current_version_completed"}}
