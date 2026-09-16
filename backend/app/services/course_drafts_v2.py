"""Create and derive independent teaching courses over the existing shared draft owner."""
from __future__ import annotations

from copy import deepcopy
from uuid import uuid4

from fastapi import HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Course, CourseCandidate, CourseRelease, CourseRevision, CourseUnit, User
from app.core.learning_evidence_contract import canonical_sha256
from app.schemas.content_platform import CourseSharedDraftReplace, CourseSharedDraftUnitWrite
from app.schemas.content_v2 import ContentPageV2
from app.schemas.course_authoring import CourseDraftCreate
from app.schemas.course_workflow import CourseCreateCommand, CourseDraftCommand, CourseForkCommand, CourseSettings, CourseUnitWrite
from app.services import content_platform, course_authoring
from app.services.access_control import get_course, lock_course_for_write, require_course_editor_or_admin
from app.services.audit import record_audit_log
from app.services.course_workflow_support import (
    adopt_workflow, authoring_course, capture_revision, course_response, current_settings,
    draft_response, draft_snapshot, ensure_lineage, finish_operation, replay_operation, validate_settings,
)
from app.services.learning_resources import get_resource_version, validate_configuration
from app.services.course_information_reviews import _ensure_internal_course_scope
from app.services.course_snapshots import release_snapshot
from app.services.course_media import reference_media, grant_fork_media


def _create_course(db: Session, actor: User, settings: CourseSettings, request: Request | None) -> Course:
    course_authoring._lock_authoring_teacher(db, actor, settings.school_id)
    normalized = validate_settings(db, actor, settings)
    payload = CourseDraftCreate.model_validate(settings.model_dump(include=set(CourseDraftCreate.model_fields)))
    data = course_authoring.create_course_draft(db, actor=actor, payload=payload, request=request, commit=False)
    course = db.get(Course, data["id"])
    course.workflow_generation = 2
    course.draft_settings_json = normalized
    _ensure_internal_course_scope(db, course)
    return course


def create_course(db: Session, *, actor: User, payload: CourseCreateCommand, request: Request | None = None) -> dict:
    course_authoring._lock_authoring_teacher(db, actor, payload.school_id)
    command = payload.model_dump(mode="json")
    replay = replay_operation(db, actor, "course.create", payload.client_request_id, command)
    if replay is not None:
        return replay
    settings = CourseSettings.model_validate(payload.model_dump(exclude={"client_request_id"}))
    course = _create_course(db, actor, settings, request)
    ensure_lineage(db, course)
    capture_revision(db, course, actor)
    return finish_operation(db, actor, "course.create", payload.client_request_id, command, course_response(db, course), scope={"access": "authoring", "school_id": course.school_id, "course_ids": [course.id]})


def list_courses(db: Session, *, actor: User, school_id: int | None = None) -> list[dict]:
    legacy = course_authoring.list_visible_course_drafts(db, actor=actor, school_id=school_id)
    courses = {course.id: course for course in db.scalars(select(Course).where(Course.id.in_([item["id"] for item in legacy]))).all()}
    return [{**item, "family_id": courses[item["id"]].family_id, "source_course_id": courses[item["id"]].source_course_id, "source_release_id": courses[item["id"]].source_release_id, "source_revision_id": courses[item["id"]].source_revision_id, "workflow_generation": courses[item["id"]].workflow_generation, "level_key": courses[item["id"]].level_key, "draft_settings": current_settings(db, courses[item["id"]], data=item)} for item in legacy]


def read_course(db: Session, *, actor: User, course_id: int) -> dict:
    return course_response(db, authoring_course(db, actor, course_id))


def read_draft(db: Session, *, actor: User, course_id: int) -> dict:
    return draft_response(db, authoring_course(db, actor, course_id))


def _prepare_units(db: Session, actor: User, course: Course, units: list[CourseUnitWrite], legacy_activity_keys: dict[int, str] | None = None) -> tuple[list[CourseSharedDraftUnitWrite], dict[int, int | None]]:
    existing = {unit.id: unit for unit in db.scalars(select(CourseUnit).where(CourseUnit.course_id == course.id)).all()}
    prepared, primary_resources = [], {}
    resource_cache: dict[int, dict] = {}
    for item in units:
        current = existing.get(item.id) if item.id else None
        if item.id is not None and current is None:
            raise HTTPException(status_code=422, detail="单元实例不属于当前课程")
        if current is not None and item.activity_key is not None and current.activity_key != item.activity_key:
            raise HTTPException(status_code=422, detail={"code": "course_unit_identity_immutable", "message": "已保存的学习活动身份不可更换"})
        activity_key = current.activity_key if current is not None else (legacy_activity_keys or {}).get(item.position, f"unit.{uuid4().hex}")
        content = item.content.model_dump(mode="json")
        referenced = []
        for block in content["blocks"]:
            if block["type"] == "media":
                reference_media(db, course, block["assetKey"], block["mediaType"], actor=actor)
            if block["type"] != "resource":
                continue
            version_id = block["resourceVersionId"]
            version = resource_cache.get(version_id)
            if version is None:
                version = resource_cache[version_id] = get_resource_version(db, version_id)
            block["configuration"] = validate_configuration(version, block["configuration"])
            referenced.append(version_id)
        primary = item.resource_version_id if item.resource_version_id is not None else next(iter(referenced), None)
        if primary is not None and primary not in referenced:
            raise HTTPException(status_code=422, detail="主资源版本必须出现在单元内容中")
        # Resource selection is versioned content. The teaching-instance key stays
        # stable; a changed resource requires an explicit result policy at review.
        primary_resources[item.position] = primary
        prepared.append(CourseSharedDraftUnitWrite(id=item.id, activity_key=activity_key, title=item.title, position=item.position, content=ContentPageV2.model_validate(content)))
    return prepared, primary_resources


def apply_draft(db: Session, *, actor: User, course: Course, settings: CourseSettings, units: list[CourseUnitWrite], expected_revision: int, request: Request | None = None, inherited_origins: dict[int, dict] | None = None, legacy_activity_keys: dict[int, str] | None = None) -> None:
    if course.content_draft_revision != expected_revision:
        raise HTTPException(status_code=409, detail={"code": "course_draft_revision_conflict", "message": "草稿已被其他教师修改，请重新读取并比较"})
    normalized = validate_settings(db, actor, settings, course=course)
    adopt_workflow(db, course)
    if course.draft_settings_json is None:
        course.draft_settings_json = current_settings(db, course)
    # Snapshot the last shared state before it changes; sync compares actual revisions.
    capture_revision(db, course, actor)
    prepared, primary = _prepare_units(db, actor, course, units, legacy_activity_keys)
    course.draft_settings_json = normalized
    db.flush()
    content_platform.replace_course_draft(db, actor=actor, course_id=course.id, payload=CourseSharedDraftReplace(expected_revision=expected_revision, units=prepared), request=request, commit=False, allow_unpublished=True, draft_metadata=normalized)
    current = {unit.position: unit for unit in db.scalars(select(CourseUnit).where(CourseUnit.course_id == course.id, CourseUnit.position > 0)).all()}
    for item in prepared:
        unit = current[item.position]
        unit.resource_version_id = primary[item.position]
        previous = dict(unit.block_origins_json or {})
        inherited = (inherited_origins or {}).get(item.position)
        if inherited:
            unit.origin_key = inherited["origin_key"]
            previous = inherited["block_origins"]
        unit.block_origins_json = {**previous, **{block.blockId: previous.get(block.blockId, f"{unit.origin_key}:{block.blockId}") for block in item.content.blocks}}
    db.flush()
    capture_revision(db, course, actor)


def save_draft(db: Session, *, actor: User, course_id: int, payload: CourseDraftCommand, request: Request | None = None, legacy_activity_keys: dict[int, str] | None = None) -> dict:
    course = authoring_course(db, actor, course_id, write=True)
    command = {"course_id": course_id, **payload.model_dump(mode="json")}
    if legacy_activity_keys is not None:
        command["legacy_activity_keys"] = legacy_activity_keys
    replay = replay_operation(db, actor, "course.draft.save", payload.client_request_id, command)
    if replay is not None:
        return replay
    if payload.expected_state_token != canonical_sha256(draft_snapshot(db, course)):
        raise HTTPException(status_code=409, detail={"code": "course_draft_state_conflict", "message": "课程资料或内容已变化，请重新读取后再保存"})
    apply_draft(db, actor=actor, course=course, settings=payload.settings, units=payload.units, expected_revision=payload.expected_revision, request=request, legacy_activity_keys=legacy_activity_keys)
    return finish_operation(db, actor, "course.draft.save", payload.client_request_id, command, draft_response(db, course), scope={"access": "authoring", "school_id": course.school_id, "course_ids": [course.id]})


def _fork_source(db: Session, actor: User, source: Course, payload: CourseForkCommand) -> tuple[dict, int | None, int | None]:
    if payload.source_release_id is not None:
        course_authoring._lock_authoring_teacher(db, actor, source.school_id)
        release = db.scalar(select(CourseRelease).where(CourseRelease.id == payload.source_release_id, CourseRelease.course_id == source.id))
        if release is None or source.status != "published":
            raise HTTPException(status_code=404, detail="可取用的发布版本不存在")
        snapshot, _ = release_snapshot(db, source, release)
        candidate = db.get(CourseCandidate, release.candidate_id) if release.candidate_id else None
        return snapshot, release.id, candidate.revision_id if candidate else None
    require_course_editor_or_admin(db, actor, source)
    if payload.source_revision_id is not None:
        revision = db.scalar(select(CourseRevision).where(CourseRevision.id == payload.source_revision_id, CourseRevision.course_id == source.id))
        if revision is None:
            raise HTTPException(status_code=404, detail="来源修订不存在")
        return deepcopy(revision.snapshot_json), None, revision.id
    if source.content_draft_revision != payload.expected_source_revision:
        raise HTTPException(status_code=409, detail="来源草稿已变化，请重新选择版本")
    adopt_workflow(db, source)
    revision = capture_revision(db, source, actor)
    return deepcopy(revision.snapshot_json), None, revision.id


def fork_course(db: Session, *, actor: User, source_course_id: int, payload: CourseForkCommand, request: Request | None = None) -> dict:
    source = get_course(db, source_course_id)
    course_authoring._lock_authoring_teacher(db, actor, source.school_id)
    if payload.settings.school_id != source.school_id:
        raise HTTPException(status_code=403, detail="教学版本只能在本校取用")
    source = lock_course_for_write(db, source.id)
    if payload.source_release_id is None:
        require_course_editor_or_admin(db, actor, source)
    elif source.status != "published":
        raise HTTPException(status_code=409, detail="来源课程当前不可取用")
    command = {"source_course_id": source_course_id, **payload.model_dump(mode="json")}
    replay = replay_operation(db, actor, "course.fork", payload.client_request_id, command)
    if replay is not None:
        return replay
    snapshot, source_release_id, source_revision_id = _fork_source(db, actor, source, payload)
    ensure_lineage(db, source)
    target = _create_course(db, actor, payload.settings, request)
    ensure_lineage(db, target, family_id=source.family_id)
    target.source_course_id, target.source_release_id = source.id, source_release_id
    target.source_revision_id = source_revision_id
    grant_fork_media(db, actor, source, target, snapshot)
    units, origins, warnings = [], {}, []
    for item in snapshot["units"]:
        if item["content"] is None:
            raise HTTPException(status_code=409, detail="来源包含尚无结构化内容的旧单元，请先补齐内容")
        content = deepcopy(item["content"])
        block_origins = {}
        for block in content["blocks"]:
            source_key = item["block_origins"].get(block["blockId"], f"{item['origin_key']}:{block['blockId']}")
            block["blockId"] = f"block-{uuid4().hex}"
            block_origins[block["blockId"]] = source_key
        completion = (content.get("courseUnit") or {}).get("completion")
        if completion and completion["preset"] == "assignment_reviewed":
            content["courseUnit"]["completion"] = None
            warnings.append(f"{item['title']}：请为新教学版本重新布置作业并选择完成条件")
        units.append(CourseUnitWrite(title=item["title"], position=item["position"], resource_version_id=item.get("resource_version_id"), content=ContentPageV2.model_validate(content)))
        origins[item["position"]] = {"origin_key": item["origin_key"], "block_origins": block_origins}
    apply_draft(db, actor=actor, course=target, settings=payload.settings, units=units, expected_revision=0, request=request, inherited_origins=origins)
    record_audit_log(db, actor=actor, action="course.fork", resource_type="course", resource_id=target.id, school_id=target.school_id, request=request, event_result="success", snapshot={"source_course_id": source.id, "source_release_id": source_release_id, "copied_units": len(units), "copied_learners": 0, "copied_results": 0})
    response = {"course": course_response(db, target), "draft": draft_response(db, target, warnings=warnings), "copied_units": len(units), "warnings": warnings}
    return finish_operation(db, actor, "course.fork", payload.client_request_id, command, response, scope={"access": "authoring", "school_id": target.school_id, "course_ids": [target.id]})


def read_revision(db: Session, *, actor: User, course_id: int, revision_id: int) -> dict:
    authoring_course(db, actor, course_id)
    revision = db.scalar(select(CourseRevision).where(CourseRevision.id == revision_id, CourseRevision.course_id == course_id))
    if revision is None:
        raise HTTPException(status_code=404, detail="修订不存在")
    return {"id": revision.id, "course_id": course_id, "revision_number": revision.revision_number, "content_sha256": revision.content_sha256, "created_by_user_id": revision.created_by_user_id, "created_at": revision.created_at, "snapshot": deepcopy(revision.snapshot_json)}


def list_revisions(db: Session, *, actor: User, course_id: int, limit: int, offset: int) -> dict:
    authoring_course(db, actor, course_id)
    statement = select(CourseRevision.id, CourseRevision.course_id, CourseRevision.revision_number, CourseRevision.content_sha256, CourseRevision.created_by_user_id, CourseRevision.created_at).where(CourseRevision.course_id == course_id)
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    items = [dict(row) for row in db.execute(statement.order_by(CourseRevision.revision_number.desc()).offset(offset).limit(limit)).mappings()]
    return {"items": items, "total": total, "offset": offset, "limit": limit, "next_offset": offset + len(items) if offset + len(items) < total else None}
