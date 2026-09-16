"""Atomic source/target submission. Previews are recomputed before any mutation."""
from copy import deepcopy

from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.course_workflow_contract import candidate_fingerprint
from app.core.learning_evidence_contract import canonical_sha256
from app.models import Course, CourseCandidate, CourseChangeBatch, CourseReviewItem, CourseRevision, User
from app.schemas.course_workflow import CourseSettings, CourseUnitWrite, SubmissionPreviewCommand, SubmitCandidateCommand
from app.services.audit import record_audit_log
from app.services.course_drafts_v2 import apply_draft
from app.services.course_snapshots import freeze_dependencies, publication_baseline, resolve_result_policies, review_impact
from app.services.course_sync import apply_sync, compare_sync
from app.services.course_workflow_support import adopt_workflow, authoring_course, capture_revision, draft_snapshot, finish_operation, replay_operation


def _scope(db: Session, actor: User, source_id: int, targets: list[int], *, write: bool) -> dict[int, Course]:
    if source_id in targets:
        raise HTTPException(status_code=422, detail="源课程不能同时作为同步目标")
    courses = {key: authoring_course(db, actor, key, write=write, owner=bool(targets)) for key in sorted([source_id, *targets])}
    source = courses[source_id]
    for key in targets:
        target = courses[key]
        if source.family_id is None or target.family_id != source.family_id or target.school_id != source.school_id:
            raise HTTPException(status_code=403, detail="仅可同步本人名下、同校且同源的教学版本")
    return courses


def _preview(db: Session, courses: dict[int, Course], source_id: int, payload: SubmissionPreviewCommand) -> tuple[dict, dict[int, dict]]:
    source = courses[source_id]
    snapshots = {key: draft_snapshot(db, course) for key, course in courses.items()}
    if source.content_draft_revision != payload.source_revision or canonical_sha256(snapshots[source_id]) != payload.source_state_token:
        raise HTTPException(status_code=409, detail="源课程已变化，请重新预览")
    if not snapshots[source_id]["units"]:
        raise HTTPException(status_code=422, detail="空课程不能送审")
    base = None
    if payload.base_revision_id is not None:
        base = db.scalar(select(CourseRevision).where(CourseRevision.id == payload.base_revision_id, CourseRevision.course_id == source_id))
        if base is None or base.revision_number >= source.content_draft_revision:
            raise HTTPException(status_code=422, detail="同步起点必须为源课程较早的真实修订")
    if payload.target_course_ids and base is None:
        raise HTTPException(status_code=422, detail="请指定此次公共内容修改前的修订")
    pending = {item.course_id: item.id for item in db.scalars(select(CourseReviewItem).where(CourseReviewItem.course_id.in_(courses), CourseReviewItem.status == "submitted"))}
    items = []
    for key, course in courses.items():
        changes = compare_sync(base.snapshot_json, snapshots[source_id], snapshots[key], key) if key != source_id else []
        proposed, _ = apply_sync(snapshots[key], changes, payload.conflict_choices)
        release, old, old_deps = publication_baseline(db, course)
        dependencies = freeze_dependencies(db, course, proposed)
        items.append({"course_id": key, "title": proposed["settings"]["title"], "revision": course.content_draft_revision, "state_token": canonical_sha256(snapshots[key]), "base_release_id": release.id if release else None, "pending_review_id": pending.get(key), "changes": changes, "impact": review_impact(proposed, old, dependencies, old_deps), "dependencies_sha256": canonical_sha256(dependencies)})
    data = {"source_course_id": source_id, "source_revision": payload.source_revision, "base_revision_id": payload.base_revision_id, "courses": items}
    return {**data, "preview_token": canonical_sha256(data)}, snapshots


def preview_submission(db: Session, *, actor: User, course_id: int, payload: SubmissionPreviewCommand) -> dict:
    return _preview(db, _scope(db, actor, course_id, payload.target_course_ids, write=False), course_id, payload)[0]


def submit_candidates(db: Session, *, actor: User, course_id: int, payload: SubmitCandidateCommand, request: Request | None = None) -> dict:
    courses = _scope(db, actor, course_id, payload.target_course_ids, write=True)
    command = {"course_id": course_id, **payload.model_dump(mode="json")}
    replay = replay_operation(db, actor, "course.submit", payload.client_request_id, command)
    if replay is not None:
        return replay
    preview, snapshots = _preview(db, courses, course_id, payload)
    if preview["preview_token"] != payload.preview_token:
        raise HTTPException(status_code=409, detail="预览已过期，源课程、目标草稿或审核状态已经变化")
    conflicts = {item["key"] for course in preview["courses"] for item in course["changes"] if item["status"] == "conflict"}
    if set(payload.conflict_choices) != conflicts:
        raise HTTPException(status_code=422, detail="请逐项决定全部冲突，不得提交预览之外的选择")
    if set(payload.result_policies) - {str(key) for key in courses}:
        raise HTTPException(status_code=422, detail="结果策略超出本次课程范围")
    source = courses[course_id]
    adopt_workflow(db, source)
    source_revision = capture_revision(db, source, actor)
    batch = CourseChangeBatch(school_id=source.school_id, created_by_user_id=actor.id, client_request_id=payload.client_request_id, request_sha256=canonical_sha256(command), source_revision_id=source_revision.id, note=payload.note)
    db.add(batch)
    db.flush()
    receipts, skipped = [], []
    for entry in preview["courses"]:
        key = entry["course_id"]
        course = courses[key]
        proposed, applied = apply_sync(snapshots[key], entry["changes"], payload.conflict_choices)
        if key != course_id and not applied:
            skipped.append({"course_id": key, "reason": "没有需要同步的修改，保留当前草稿"})
            continue
        if entry["pending_review_id"] is not None:
            raise HTTPException(status_code=409, detail=f"{entry['title']} 已有待审候选，请先处理或撤回")
        if key != course_id:
            units = [CourseUnitWrite.model_validate({field: item[field] for field in CourseUnitWrite.model_fields if field in item}) for item in proposed["units"]]
            apply_draft(db, actor=actor, course=course, settings=CourseSettings.model_validate(proposed["settings"]), units=units, expected_revision=entry["revision"], request=request)
        revision = capture_revision(db, course, actor)
        release, baseline, old_deps = publication_baseline(db, course)
        dependencies = freeze_dependencies(db, course, revision.snapshot_json)
        impact = review_impact(revision.snapshot_json, baseline, dependencies, old_deps)
        impact["sync"] = {"source_course_id": course_id, "source_revision_id": source_revision.id, "base_revision_id": payload.base_revision_id, "applied_changes": applied, "preview_changes": entry["changes"]}
        policies = resolve_result_policies(impact, payload.result_policies.get(str(key), {}))
        base_id = release.id if release else None
        candidate = CourseCandidate(batch_id=batch.id, course_id=key, revision_id=revision.id, base_release_id=base_id, result_policy_json=policies, impact_json=impact, dependencies_json=dependencies, candidate_sha256=candidate_fingerprint(course_id=key, revision_id=revision.id, revision_sha256=revision.content_sha256, base_release_id=base_id, policies=policies, impact=impact, dependencies=dependencies))
        db.add(candidate)
        db.flush()
        review = CourseReviewItem(candidate_id=candidate.id, course_id=key, school_id=course.school_id)
        db.add(review)
        db.flush()
        receipts.append({"course_id": key, "candidate_id": candidate.id, "revision_id": revision.id, "review_item_id": review.id, "review_version": review.version, "status": review.status})
    record_audit_log(db, actor=actor, action="course.batch.submit", resource_type="course_change_batch", resource_id=batch.id, school_id=source.school_id, request=request, event_result="success", snapshot={"items": receipts, "skipped": skipped})
    return finish_operation(db, actor, "course.submit", payload.client_request_id, command, {"batch_id": batch.id, "items": receipts, "skipped": skipped}, scope={"access": "authoring", "school_id": source.school_id, "course_ids": sorted(courses)})
