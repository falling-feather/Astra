"""Review frozen per-course candidates; a selected batch is one transaction."""
from copy import deepcopy

from fastapi import HTTPException, Request
from sqlalchemy import exists, func, or_, select, update
from sqlalchemy.orm import Session

from app.core.course_workflow_contract import candidate_fingerprint
from app.core.learning_evidence_contract import canonical_sha256
from app.models import ClassGroup, Course, CourseCandidate, CourseChangeBatch, CourseCollaborator, CourseRelease, CourseReviewItem, CourseRevision, School, User
from app.models.base import utc_now
from app.schemas.course_workflow import ReviewCommand, WithdrawCommand
from app.services.access_control import lock_course_for_write, teacher_school_ids
from app.services.admin_common import lock_active_admin, require_admin
from app.services.audit import record_audit_log
from app.services.course_snapshots import latest_release, release_snapshot
from app.services.course_workflow_support import authoring_course, finish_operation, replay_operation
from app.services.security_control_locks import ADMIN_AUTHORITY_LOCK, acquire_security_control_lock


def verified_revision(db: Session, candidate: CourseCandidate) -> CourseRevision:
    revision = db.get(CourseRevision, candidate.revision_id)
    if revision is None or revision.course_id != candidate.course_id or canonical_sha256(revision.snapshot_json) != revision.content_sha256:
        raise HTTPException(status_code=409, detail="候选修订完整性检查未通过")
    expected = candidate_fingerprint(course_id=candidate.course_id, revision_id=revision.id, revision_sha256=revision.content_sha256, base_release_id=candidate.base_release_id, policies=candidate.result_policy_json, impact=candidate.impact_json, dependencies=candidate.dependencies_json or {})
    if expected != candidate.candidate_sha256:
        raise HTTPException(status_code=409, detail="审核候选内容或依赖已变化")
    return revision


def _summary(candidate: CourseCandidate, review: CourseReviewItem, course: Course, release_id: int | None) -> dict:
    return {"candidate_id": candidate.id, "batch_id": candidate.batch_id, "course_id": candidate.course_id, "course_title": course.title, "school_id": course.school_id, "revision_id": candidate.revision_id, "base_release_id": candidate.base_release_id, "review_item_id": review.id, "review_version": review.version, "status": review.status, "review_note": review.review_note, "reviewed_by_user_id": review.reviewed_by_user_id, "reviewed_at": review.reviewed_at, "created_at": candidate.created_at, "published_release_id": release_id, "candidate_sha256": candidate.candidate_sha256}


def list_candidates(db: Session, *, actor: User, school_id: int | None = None, course_id: int | None = None, batch_id: int | None = None, status: str | None = None, limit: int = 25, offset: int = 0) -> dict:
    if actor.role not in {"teacher", "admin"}:
        raise HTTPException(status_code=403, detail="需要课程创作或学校管理权限")
    statement = select(CourseCandidate, CourseReviewItem, Course, CourseRelease.id).join(CourseReviewItem, CourseReviewItem.candidate_id == CourseCandidate.id).join(Course, Course.id == CourseCandidate.course_id).outerjoin(CourseRelease, CourseRelease.candidate_id == CourseCandidate.id)
    if actor.role != "admin":
        statement = statement.where(Course.school_id.in_(teacher_school_ids(db, actor.id)), or_(Course.creator_user_id == actor.id, exists().where(CourseCollaborator.course_id == Course.id, CourseCollaborator.user_id == actor.id, CourseCollaborator.status == "active")))
    if course_id is not None:
        authoring_course(db, actor, course_id)
        statement = statement.where(Course.id == course_id)
    if school_id is not None:
        statement = statement.where(Course.school_id == school_id)
    if batch_id is not None:
        statement = statement.where(CourseCandidate.batch_id == batch_id)
    if status is not None:
        if status not in {"submitted", "approved", "rejected", "withdrawn"}:
            raise HTTPException(status_code=422, detail="不支持的审核状态")
        statement = statement.where(CourseReviewItem.status == status)
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = db.execute(statement.order_by(CourseCandidate.id.desc()).offset(offset).limit(limit)).all()
    return {"items": [_summary(*row) for row in rows], "total": total, "offset": offset, "limit": limit, "next_offset": offset + len(rows) if offset + len(rows) < total else None}


def read_candidate(db: Session, *, actor: User, candidate_id: int) -> dict:
    candidate = db.get(CourseCandidate, candidate_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="候选不存在")
    course = authoring_course(db, actor, candidate.course_id)
    revision = verified_revision(db, candidate)
    review = db.scalar(select(CourseReviewItem).where(CourseReviewItem.candidate_id == candidate_id))
    release_id = db.scalar(select(CourseRelease.id).where(CourseRelease.candidate_id == candidate_id))
    base = db.get(CourseRelease, candidate.base_release_id) if candidate.base_release_id else None
    baseline = release_snapshot(db, course, base)[0] if base else {"settings": {}, "units": []}
    batch = db.get(CourseChangeBatch, candidate.batch_id)
    current = latest_release(db, course.id)
    user_ids = {batch.created_by_user_id, course.creator_user_id, revision.created_by_user_id}
    class_ids = set()
    for snapshot in (revision.snapshot_json, baseline):
        user_ids.update(snapshot["settings"].get("collaborator_user_ids", []))
        class_ids.update(snapshot["settings"].get("admission_class_ids", []))
    authority = (candidate.dependencies_json or {}).get("governance", {})
    user_ids.update(item["user_id"] for item in authority.get("collaborators", []))
    class_ids.update(authority.get("admission_class_ids", []))
    labels = {"users": {str(user.id): user.display_name for user in db.scalars(select(User).where(User.id.in_(user_ids)))}, "classes": {str(group.id): group.name for group in db.scalars(select(ClassGroup).where(ClassGroup.id.in_(class_ids), ClassGroup.school_id == course.school_id))}, "schools": {str(course.school_id): db.get(School, course.school_id).name}}
    return {**_summary(candidate, review, course, release_id), "snapshot": deepcopy(revision.snapshot_json), "baseline": baseline, "impact": deepcopy(candidate.impact_json), "result_policies": deepcopy(candidate.result_policy_json), "dependencies": deepcopy(candidate.dependencies_json or {}), "source_revision_id": batch.source_revision_id, "submitted_by_user_id": batch.created_by_user_id, "note": batch.note, "stale": (current.id if current else None) != candidate.base_release_id, "entity_labels": labels}


def review_candidates(db: Session, *, actor: User, payload: ReviewCommand, request: Request | None = None) -> dict:
    require_admin(actor)
    acquire_security_control_lock(db, ADMIN_AUTHORITY_LOCK)
    actor = lock_active_admin(db, actor.id)
    command = payload.model_dump(mode="json")
    replay = replay_operation(db, actor, "course.review", payload.client_request_id, command)
    if replay is not None:
        return replay
    rows = list(db.scalars(select(CourseReviewItem).where(CourseReviewItem.id.in_([item.review_item_id for item in payload.items])).order_by(CourseReviewItem.course_id)))
    if len(rows) != len(payload.items):
        raise HTTPException(status_code=404, detail="部分审核项不存在")
    expected = {item.review_item_id: item.expected_version for item in payload.items}
    now, results = utc_now(), []
    for review in rows:
        course = lock_course_for_write(db, review.course_id)
        candidate = db.get(CourseCandidate, review.candidate_id)
        verified_revision(db, candidate)
        if payload.decision == "approved":
            current = latest_release(db, course.id)
            if course.status == "archived" or (current.id if current else None) != candidate.base_release_id:
                raise HTTPException(status_code=409, detail="课程已归档或发布基线变化，请教师重新提交")
        changed = db.execute(update(CourseReviewItem).where(CourseReviewItem.id == review.id, CourseReviewItem.status == "submitted", CourseReviewItem.version == expected[review.id]).values(status=payload.decision, active_key=None, version=expected[review.id] + 1, reviewed_by_user_id=actor.id, review_note=payload.note, reviewed_at=now, updated_at=now))
        if changed.rowcount != 1:
            raise HTTPException(status_code=409, detail="审核项已被处理，本次选中范围未作部分修改")
        result = {"course_id": course.id, "review_item_id": review.id, "candidate_id": candidate.id, "status": payload.decision, "review_version": expected[review.id] + 1}
        results.append(result)
        record_audit_log(db, actor=actor, action="course.candidate.review", resource_type="course_review_item", resource_id=review.id, school_id=course.school_id, request=request, event_result="success", snapshot={**result, "note": payload.note, "candidate_sha256": candidate.candidate_sha256})
    return finish_operation(db, actor, "course.review", payload.client_request_id, command, {"items": results}, scope={"access": "admin", "course_ids": [row.course_id for row in rows]})


def withdraw_candidate(db: Session, *, actor: User, candidate_id: int, payload: WithdrawCommand, request: Request | None = None) -> dict:
    candidate = db.get(CourseCandidate, candidate_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="候选不存在")
    course = authoring_course(db, actor, candidate.course_id, write=True)
    command = {"candidate_id": candidate_id, **payload.model_dump(mode="json")}
    replay = replay_operation(db, actor, "course.withdraw", payload.client_request_id, command)
    if replay is not None:
        return replay
    review = db.scalar(select(CourseReviewItem).where(CourseReviewItem.candidate_id == candidate_id))
    if db.scalar(select(CourseRelease.id).where(CourseRelease.candidate_id == candidate_id)):
        raise HTTPException(status_code=409, detail="已发布候选不可撤回，请从历史版本建立新修订")
    changed = db.execute(update(CourseReviewItem).where(CourseReviewItem.id == review.id, CourseReviewItem.version == payload.expected_version, CourseReviewItem.status.in_(["submitted", "approved"])).values(status="withdrawn", active_key=None, version=payload.expected_version + 1, updated_at=utc_now()))
    if changed.rowcount != 1:
        raise HTTPException(status_code=409, detail="候选状态已变化，请重新读取")
    response = {"candidate_id": candidate_id, "status": "withdrawn", "review_version": payload.expected_version + 1}
    record_audit_log(db, actor=actor, action="course.candidate.withdraw", resource_type="course_candidate", resource_id=candidate_id, school_id=course.school_id, request=request, event_result="success", snapshot=response)
    return finish_operation(db, actor, "course.withdraw", payload.client_request_id, command, response, scope={"access": "authoring", "school_id": course.school_id, "course_ids": [course.id]})
