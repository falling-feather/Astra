"""One publisher for v2 and legacy callers; only approved snapshots may enter."""
from copy import deepcopy

from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.course_workflow_contract import comparable_page
from app.core.learning_evidence_contract import canonical_sha256
from app.models import ContentDraft, Course, CourseCandidate, CourseRelease, CourseReviewItem, CourseRevision, CourseUnit, User
from app.schemas.content_platform import CourseReleasePublish
from app.schemas.content_v2 import ContentPageV2
from app.schemas.course_workflow import CourseSettings, CourseUnitWrite, PublishCommand, PublishSelection, RestoreDraftCommand
from app.services import content_platform, course_authoring, course_information_reviews as information
from app.services.audit import record_audit_log
from app.services.course_drafts_v2 import apply_draft
from app.services.course_reviews_v2 import verified_revision
from app.services.course_snapshots import freeze_dependencies, latest_release, release_snapshot
from app.services.course_workflow_support import authoring_course, capture_revision, draft_response, draft_snapshot, finish_operation, replay_operation, validate_settings


def assert_approved_specs(db: Session, *, course: Course, specs: list[dict], candidate_id: int | None, candidate_sha256: str | None) -> None:
    candidate = db.get(CourseCandidate, candidate_id) if candidate_id else None
    review = db.scalar(select(CourseReviewItem).where(CourseReviewItem.candidate_id == candidate_id)) if candidate else None
    if candidate is None or candidate.course_id != course.id or review is None or review.status != "approved" or candidate.candidate_sha256 != candidate_sha256:
        raise HTTPException(status_code=409, detail="发布需要该课程已通过的审核候选")
    revision = verified_revision(db, candidate)
    frozen = {unit["id"]: unit for unit in revision.snapshot_json["units"]}
    if len(specs) != len(frozen) or {spec["unit"].id for spec in specs} != set(frozen):
        raise HTTPException(status_code=409, detail="发布单元与审核范围不一致")
    for spec in specs:
        unit = frozen[spec["unit"].id]
        if spec["snapshot_title"] != unit["title"] or spec["snapshot_position"] != unit["position"] or comparable_page(spec["published_content"].model_dump(mode="json")) != comparable_page(unit["content"]):
            raise HTTPException(status_code=409, detail="发布正文与审核快照不一致")


def _apply_published_settings(db: Session, course: Course, settings: CourseSettings) -> None:
    course_authoring._require_available_title(db, course.school_id, settings.title, course.id)
    teachers = information._lock_eligible_teachers(db, school_id=course.school_id, teacher_ids=[course.creator_user_id, *settings.collaborator_user_ids])
    classes = information._lock_admission_classes(db, school_id=course.school_id, class_ids=settings.admission_class_ids)
    information._apply_course_information(course, settings)
    course.level_key = settings.level_key
    information._sync_course_collaborators(db, course=course, teachers=teachers)
    information._sync_course_admission_classes(db, course=course, admission_classes=classes)
    if course.course_code is None:
        course.course_code = information._generate_unique_course_code(db)
    information._ensure_internal_course_scope(db, course)
    course.status = "published"


def _specs(db: Session, actor: User, course: Course, revision: CourseRevision, number: int, roll: bool) -> list[dict]:
    units = {unit.id: unit for unit in db.scalars(select(CourseUnit).where(CourseUnit.course_id == course.id))}
    editable = {draft.course_unit_id: draft for draft in db.scalars(select(ContentDraft).where(ContentDraft.course_id == course.id, ContentDraft.active_key == content_platform.SHARED_DRAFT_ACTIVE_KEY))}
    specs = []
    for frozen in sorted(revision.snapshot_json["units"], key=lambda item: item["position"]):
        unit = units.get(frozen["id"])
        if unit is None or unit.activity_key != frozen["activity_key"] or (roll and unit.id not in editable):
            raise HTTPException(status_code=409, detail="候选单元实例已失效")
        source = deepcopy(frozen["content"])
        draft = ContentDraft(course_id=course.id, course_unit_id=unit.id, revision=revision.revision_number, author_user_id=revision.created_by_user_id, last_editor_user_id=revision.created_by_user_id, target_slug=source["slug"], title=frozen["title"], status="published", active_key=None, schema_json=source, schema_hash=content_platform._canonical_sha256(source), allow_script=False, script_risk_level="none", script_review_status="not_required")
        db.add(draft)
        published = ContentPageV2.model_validate({**source, "status": "published", "version": f"course-{course.id}-release-{number}"})
        payload = published.model_dump(mode="json")
        specs.append({"unit": unit, "draft": draft, "editable_draft": editable.get(unit.id), "snapshot_title": frozen["title"], "snapshot_position": frozen["position"], "published_content": published, "schema_sha256": content_platform._canonical_sha256(payload), "package_schema_sha256": content_platform._canonical_sha256({**payload, "version": "release"}), "media_snapshot": content_platform._media_snapshot(payload)})
    db.flush()
    return specs


def publish_candidates(db: Session, *, actor: User, payload: PublishCommand, request: Request | None = None) -> dict:
    candidates = list(db.scalars(select(CourseCandidate).where(CourseCandidate.id.in_([item.candidate_id for item in payload.items])).order_by(CourseCandidate.course_id)))
    if len(candidates) != len(payload.items):
        raise HTTPException(status_code=404, detail="部分发布候选不存在")
    if len({item.course_id for item in candidates}) != len(candidates):
        raise HTTPException(status_code=422, detail="一次发布只能选择每门课程的一个候选")
    courses = {item.course_id: authoring_course(db, actor, item.course_id, write=True) for item in candidates}
    command = payload.model_dump(mode="json")
    replay = replay_operation(db, actor, "course.publish", payload.client_request_id, command)
    if replay is not None:
        return replay
    expected = {item.candidate_id: item.expected_review_version for item in payload.items}
    releases = []
    for candidate in candidates:
        course = courses[candidate.course_id]
        review = db.scalar(select(CourseReviewItem).where(CourseReviewItem.candidate_id == candidate.id).with_for_update().execution_options(populate_existing=True))
        if review is None or review.status != "approved" or review.version != expected[candidate.id]:
            raise HTTPException(status_code=409, detail="候选尚未通过审核或审核状态已变化")
        if db.scalar(select(CourseRelease.id).where(CourseRelease.candidate_id == candidate.id)):
            raise HTTPException(status_code=409, detail={"code": "course_candidate_already_published", "message": "候选已发布，请通过原请求编号回读结果"})
        previous = latest_release(db, course.id)
        if (previous.id if previous else None) != candidate.base_release_id:
            raise HTTPException(status_code=409, detail="此候选基于旧发布版，请重新预览并提交审核")
        revision = verified_revision(db, candidate)
        if freeze_dependencies(db, course, revision.snapshot_json) != candidate.dependencies_json:
            raise HTTPException(status_code=409, detail="课程授权、资源或作业已变化，请重新预览并送审")
        settings = CourseSettings.model_validate(revision.snapshot_json["settings"])
        # Eligibility is rechecked at publication; the approved metadata does not
        # depend on a later working draft or on which co-teacher clicks Publish.
        creator = db.get(User, course.creator_user_id)
        validate_settings(db, creator, settings, course=None)
        roll = course.content_draft_revision == revision.revision_number
        if roll and canonical_sha256(draft_snapshot(db, course)) != revision.content_sha256:
            raise HTTPException(status_code=409, detail="当前修订发生漂移，请先核对草稿")
        number = (previous.release_number if previous else 0) + 1
        _apply_published_settings(db, course, settings)
        specs = _specs(db, actor, course, revision, number, roll)
        published = content_platform.publish_prepared_course(db, actor=actor, course=course, specs=specs, release_number=number, source_revision=revision.revision_number, note=payload.note, request=request, candidate_id=candidate.id, candidate_sha256=candidate.candidate_sha256, roll_current_draft=roll, commit=False)
        if roll:
            capture_revision(db, course, actor)
        releases.append({"candidate_id": candidate.id, "course_id": course.id, **published})
    return finish_operation(db, actor, "course.publish", payload.client_request_id, command, {"items": releases}, scope={"access": "authoring", "school_id": next(iter(courses.values())).school_id, "course_ids": sorted(courses)})


def publish_legacy_request(db: Session, *, actor: User, course_id: int, payload: CourseReleasePublish, request: Request | None = None) -> dict:
    authoring_course(db, actor, course_id, write=True)
    row = db.execute(select(CourseCandidate, CourseReviewItem).join(CourseReviewItem, CourseReviewItem.candidate_id == CourseCandidate.id).join(CourseRevision, CourseRevision.id == CourseCandidate.revision_id).where(CourseCandidate.course_id == course_id, CourseRevision.revision_number == payload.expected_revision, CourseReviewItem.status == "approved").order_by(CourseCandidate.id.desc()).limit(1)).first()
    if row is None:
        raise HTTPException(status_code=409, detail={"code": "course_candidate_review_required", "message": "此修订尚未通过内容审核，请在课程工作台提交候选"})
    candidate, review = row
    result = publish_candidates(db, actor=actor, payload=PublishCommand(client_request_id=f"legacy-publish-{candidate.id}", items=[PublishSelection(candidate_id=candidate.id, expected_review_version=review.version)], note=payload.note), request=request)
    return {key: result["items"][0][key] for key in ("release", "binding", "next_draft_revision")}


def restore_draft(db: Session, *, actor: User, course_id: int, payload: RestoreDraftCommand, request: Request | None = None) -> dict:
    course = authoring_course(db, actor, course_id, write=True, owner=True)
    command = {"course_id": course_id, **payload.model_dump(mode="json")}
    replay = replay_operation(db, actor, "course.restore", payload.client_request_id, command)
    if replay is not None:
        return replay
    if payload.expected_state_token != canonical_sha256(draft_snapshot(db, course)):
        raise HTTPException(status_code=409, detail="草稿已变化，请重新读取后再建立回滚修订")
    release = db.get(CourseRelease, payload.release_id)
    if release is None or release.course_id != course_id:
        raise HTTPException(status_code=404, detail="发布版本不存在")
    snapshot, _ = release_snapshot(db, course, release)
    warnings = []
    settings = snapshot["settings"]
    if release.candidate_id is None:
        settings = {**draft_snapshot(db, course)["settings"], **settings}
        warnings.append("旧发布未保存完整课程设置；仅恢复有记录的标题、简介与内容，其余设置保留当前值")
    units = [CourseUnitWrite.model_validate({key: item[key] for key in CourseUnitWrite.model_fields if key in item}) for item in snapshot["units"]]
    apply_draft(db, actor=actor, course=course, settings=CourseSettings.model_validate(settings), units=units, expected_revision=payload.expected_revision, request=request)
    record_audit_log(db, actor=actor, action="course.restore_draft", resource_type="course", resource_id=course.id, school_id=course.school_id, request=request, event_result="success", snapshot={"source_release_id": release.id, "new_revision": course.content_draft_revision})
    return finish_operation(db, actor, "course.restore", payload.client_request_id, command, draft_response(db, course, warnings=warnings), scope={"access": "authoring", "school_id": course.school_id, "course_ids": [course.id]})
