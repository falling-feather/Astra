from datetime import UTC, datetime
import hashlib
import json

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user
from app.core.config import get_settings
from app.db.session import get_db
from app.models import ContentDraft, ContentPageRecord, ContentPageVersion, User
from app.models.base import utc_now
from app.schemas.content import (
    ContentDraftCreate,
    ContentDraftPublish,
    ContentDraftRequestChanges,
    ContentDraftRead,
    ContentDraftScriptReview,
    ContentDraftSubmit,
    ContentDraftUpdate,
    ContentDraftWithdraw,
    ContentPage,
    ContentPageRollback,
    ContentPublicationRead,
)
from app.services.audit import record_audit_log
from app.services.content_catalog import get_page_schema, list_page_summaries
from app.services.content_identity import content_stable_identity_errors
from app.services.content_script_assets import (
    ContentScriptAssetMirrorError,
    mirror_external_script_assets_for_version,
)
from app.services.content_script_host_policies import blocked_content_script_host_policies
from app.services.content_script_policy import (
    SCRIPT_POLICY_VERSION,
    analyze_content_script_policy,
    script_policy_context_hash,
    script_policy_result_from_json,
)


router = APIRouter()
CONTENT_DRAFT_STATUS_DRAFT = "draft"
CONTENT_DRAFT_STATUS_SUBMITTED = "submitted"
CONTENT_DRAFT_STATUS_CHANGES_REQUESTED = "changes_requested"
CONTENT_DRAFT_STATUS_WITHDRAWN = "withdrawn"
CONTENT_DRAFT_STATUS_PUBLISHED = "published"
CONTENT_DRAFT_ACTIVE_STATUSES = {
    CONTENT_DRAFT_STATUS_DRAFT,
    CONTENT_DRAFT_STATUS_SUBMITTED,
    CONTENT_DRAFT_STATUS_CHANGES_REQUESTED,
}
CONTENT_DRAFT_ACTIVE_KEY = "active"
CONTENT_PAGE_STATUS_PUBLISHED = "published"
SCRIPT_REVIEW_NOT_REQUIRED = "not_required"
SCRIPT_REVIEW_PENDING = "pending"
SCRIPT_REVIEW_APPROVED = "approved"


@router.post("/drafts", response_model=ContentDraftRead, status_code=status.HTTP_201_CREATED)
def create_content_draft(
    payload: ContentDraftCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ContentDraftRead:
    _require_content_author(current_user)
    target_slug = payload.target_slug.strip()
    _validate_content_slug(target_slug)
    page_schema = payload.page_schema
    if target_slug != page_schema.slug.strip():
        raise HTTPException(status_code=422, detail="target_slug must match schema.slug")
    page_schema = page_schema.model_copy(update={"slug": target_slug})
    _validate_content_stable_identity_contract(page_schema)
    script_policy = _analyze_content_script_policy(page_schema)
    if script_policy.has_blocking_findings:
        raise HTTPException(status_code=422, detail="Content schema contains blocked script policy findings")
    _reject_blocked_content_script_hosts(db, page_schema, status_code=422)
    if script_policy.has_script_findings and not payload.allow_script:
        raise HTTPException(status_code=422, detail="Content schema includes script references; allow_script is required")
    existing = db.scalar(
        select(ContentDraft).where(
            ContentDraft.author_user_id == current_user.id,
            ContentDraft.target_slug == target_slug,
            ContentDraft.status.in_(CONTENT_DRAFT_ACTIVE_STATUSES),
        )
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="Active content draft already exists for this target")

    draft_payload = page_schema.model_dump(mode="json")
    draft_schema_hash = _schema_hash(draft_payload)
    base_version = _current_content_page_version(db, target_slug)
    draft = ContentDraft(
        author_user_id=current_user.id,
        last_editor_user_id=current_user.id,
        target_slug=target_slug,
        title=page_schema.title.strip(),
        status=CONTENT_DRAFT_STATUS_DRAFT,
        active_key=CONTENT_DRAFT_ACTIVE_KEY,
        schema_json=draft_payload,
        schema_hash=draft_schema_hash,
        base_version_id=base_version.id if base_version is not None else None,
        base_schema_hash=base_version.schema_hash if base_version is not None else None,
        allow_script=payload.allow_script,
        script_risk_level=script_policy.risk_level,
        script_analysis_json=script_policy.to_json(schema_hash=draft_schema_hash),
        script_review_status=SCRIPT_REVIEW_PENDING if script_policy.requires_review else SCRIPT_REVIEW_NOT_REQUIRED,
    )
    db.add(draft)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Active content draft already exists for this target") from exc
    record_audit_log(
        db,
        actor=current_user,
        action="content.draft.create",
        resource_type="content_draft",
        resource_id=draft.id,
        event_result="success",
        request=request,
        snapshot={"after": _content_draft_snapshot(draft)},
    )
    db.commit()
    db.refresh(draft)
    return _content_draft_read(draft)


@router.get("/drafts/{draft_id}", response_model=ContentDraftRead)
def read_content_draft(
    draft_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ContentDraftRead:
    draft = db.get(ContentDraft, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Content draft not found")
    if current_user.role != "admin" and draft.author_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Content draft is outside your scope")
    return _content_draft_read(draft)


@router.patch("/drafts/{draft_id}", response_model=ContentDraftRead)
def update_content_draft(
    draft_id: int,
    payload: ContentDraftUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ContentDraftRead:
    draft = _get_content_draft_for_transition(db, draft_id)
    _require_draft_author_or_admin(draft, current_user)
    if draft.status not in {CONTENT_DRAFT_STATUS_DRAFT, CONTENT_DRAFT_STATUS_CHANGES_REQUESTED}:
        raise HTTPException(status_code=409, detail="Content draft cannot be updated from its current status")

    target_slug = draft.target_slug.strip()
    page_schema = payload.page_schema
    if target_slug != page_schema.slug.strip():
        raise HTTPException(status_code=422, detail="schema.slug must match draft target_slug")
    page_schema = page_schema.model_copy(update={"slug": target_slug})
    _validate_content_stable_identity_contract(page_schema)
    script_policy = _analyze_content_script_policy(page_schema)
    if script_policy.has_blocking_findings:
        raise HTTPException(status_code=422, detail="Content schema contains blocked script policy findings")
    _reject_blocked_content_script_hosts(db, page_schema, status_code=422)
    allow_script = draft.allow_script if payload.allow_script is None else payload.allow_script
    if script_policy.has_script_findings and not allow_script:
        raise HTTPException(status_code=422, detail="Content schema includes script references; allow_script is required")

    before = _content_draft_snapshot(draft)
    draft_payload = page_schema.model_dump(mode="json")
    draft_schema_hash = _schema_hash(draft_payload)
    draft.title = page_schema.title.strip()
    draft.last_editor_user_id = current_user.id
    draft.schema_json = draft_payload
    draft.schema_hash = draft_schema_hash
    draft.allow_script = allow_script
    draft.script_risk_level = script_policy.risk_level
    draft.script_analysis_json = script_policy.to_json(schema_hash=draft_schema_hash)
    draft.script_review_status = SCRIPT_REVIEW_PENDING if script_policy.requires_review else SCRIPT_REVIEW_NOT_REQUIRED
    draft.script_reviewed_by_user_id = None
    draft.script_reviewed_schema_hash = None
    draft.script_reviewed_at = None
    draft.script_review_note = None
    after = _content_draft_snapshot(draft)
    record_audit_log(
        db,
        actor=current_user,
        action="content.draft.update",
        resource_type="content_draft",
        resource_id=draft.id,
        event_result="success",
        request=request,
        snapshot=_transition_snapshot(before, after, payload.note),
    )
    db.commit()
    db.refresh(draft)
    return _content_draft_read(draft)


@router.post("/drafts/{draft_id}/submit", response_model=ContentDraftRead)
def submit_content_draft(
    draft_id: int,
    payload: ContentDraftSubmit,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ContentDraftRead:
    draft = _get_content_draft_for_transition(db, draft_id)
    _require_draft_author_or_admin(draft, current_user)
    if draft.status not in {CONTENT_DRAFT_STATUS_DRAFT, CONTENT_DRAFT_STATUS_CHANGES_REQUESTED}:
        raise HTTPException(status_code=409, detail="Content draft cannot be submitted from its current status")

    before = _content_draft_snapshot(draft)
    draft.status = CONTENT_DRAFT_STATUS_SUBMITTED
    draft.submitted_at = utc_now()
    draft.withdrawn_at = None
    after = _content_draft_snapshot(draft)
    record_audit_log(
        db,
        actor=current_user,
        action="content.draft.submit",
        resource_type="content_draft",
        resource_id=draft.id,
        event_result="success",
        request=request,
        snapshot=_transition_snapshot(before, after, payload.note),
    )
    db.commit()
    db.refresh(draft)
    return _content_draft_read(draft)


@router.post("/drafts/{draft_id}/withdraw", response_model=ContentDraftRead)
def withdraw_content_draft(
    draft_id: int,
    payload: ContentDraftWithdraw,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ContentDraftRead:
    draft = _get_content_draft_for_transition(db, draft_id)
    _require_draft_author_or_admin(draft, current_user)
    if draft.status not in CONTENT_DRAFT_ACTIVE_STATUSES:
        raise HTTPException(status_code=409, detail="Content draft cannot be withdrawn from its current status")

    before = _content_draft_snapshot(draft)
    draft.status = CONTENT_DRAFT_STATUS_WITHDRAWN
    draft.active_key = None
    draft.withdrawn_at = utc_now()
    after = _content_draft_snapshot(draft)
    record_audit_log(
        db,
        actor=current_user,
        action="content.draft.withdraw",
        resource_type="content_draft",
        resource_id=draft.id,
        event_result="success",
        request=request,
        snapshot=_transition_snapshot(before, after, payload.note),
    )
    db.commit()
    db.refresh(draft)
    return _content_draft_read(draft)


@router.post("/drafts/{draft_id}/request-changes", response_model=ContentDraftRead)
def request_content_draft_changes(
    draft_id: int,
    payload: ContentDraftRequestChanges,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ContentDraftRead:
    _require_admin(current_user)
    draft = _get_content_draft_for_transition(db, draft_id)
    if draft.status != CONTENT_DRAFT_STATUS_SUBMITTED:
        raise HTTPException(status_code=409, detail="Content draft must be submitted before requesting changes")
    note = _strip_required(payload.note)

    before = _content_draft_snapshot(draft)
    draft.status = CONTENT_DRAFT_STATUS_CHANGES_REQUESTED
    draft.change_requested_by_user_id = current_user.id
    draft.change_requested_at = utc_now()
    draft.change_request_note = note
    after = _content_draft_snapshot(draft)
    record_audit_log(
        db,
        actor=current_user,
        action="content.draft.request_changes",
        resource_type="content_draft",
        resource_id=draft.id,
        event_result="success",
        request=request,
        snapshot=_transition_snapshot(before, after, note),
    )
    db.commit()
    db.refresh(draft)
    return _content_draft_read(draft)


@router.post("/drafts/{draft_id}/publish", response_model=ContentPublicationRead)
def publish_content_draft(
    draft_id: int,
    payload: ContentDraftPublish,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ContentPublicationRead:
    _require_admin(current_user)
    draft = _get_content_draft_for_transition(db, draft_id)
    if draft.status != CONTENT_DRAFT_STATUS_SUBMITTED:
        raise HTTPException(status_code=409, detail="Content draft must be submitted before publishing")
    draft_page_schema = ContentPage.model_validate(draft.schema_json)
    _reject_blocked_content_script_hosts(db, draft_page_schema, status_code=409)
    script_policy = _content_draft_script_policy(draft, verify_external_assets=True)
    if script_policy.has_blocking_findings:
        raise HTTPException(status_code=409, detail="Content draft script policy findings must be resolved before publishing")
    if script_policy.has_script_findings and not draft.allow_script:
        raise HTTPException(status_code=409, detail="Content schema includes script references; script review is required")
    if script_policy.requires_review and draft.script_review_status != SCRIPT_REVIEW_APPROVED:
        raise HTTPException(status_code=409, detail="Content draft script review must be approved before publishing")
    if script_policy.requires_review and draft.script_reviewed_schema_hash != draft.schema_hash:
        raise HTTPException(status_code=409, detail="Content draft script review does not match the current schema")
    _validate_content_stable_identity_contract(ContentPage.model_validate(draft.schema_json), status_code=409)
    _reject_stale_content_draft(db, draft)

    target_slug = draft.target_slug.strip()
    _validate_content_slug(target_slug)
    previous_version = _current_content_page_version(db, target_slug)
    version = _next_content_version(db, target_slug)
    page_schema = _published_page_schema(draft.schema_json, target_slug, version)
    page_payload = page_schema.model_dump(mode="json")
    page = db.scalar(select(ContentPageRecord).where(ContentPageRecord.slug == target_slug))
    page_before = _content_page_snapshot(page) if page is not None else None
    if page is None:
        page = ContentPageRecord(
            slug=target_slug,
            status=CONTENT_PAGE_STATUS_PUBLISHED,
            version=version,
            schema_json=page_payload,
        )
        db.add(page)
    else:
        page.status = CONTENT_PAGE_STATUS_PUBLISHED
        page.version = version
        page.schema_json = page_payload
    _flush_or_raise_publication_conflict(db)

    version_record = _new_content_page_version(
        db,
        page=page,
        page_schema=page_schema,
        publisher=current_user,
        note=payload.note,
        source_draft_id=draft.id,
        restored_from_version_id=None,
        previous_version_id=previous_version.id if previous_version is not None else None,
    )
    page.schema_hash = version_record.schema_hash
    page.current_version_id = version_record.id
    page.published_by_user_id = current_user.id
    page.published_at = version_record.published_at
    try:
        mirror_external_script_assets_for_version(
            db,
            page=page,
            version=version_record,
            page_schema=page_schema,
            publisher=current_user,
            policy_version=script_policy.policy_version,
            policy_context_hash=script_policy.policy_context_hash,
        )
    except ContentScriptAssetMirrorError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Content draft external script assets could not be mirrored before publishing",
        ) from exc
    draft_before = _content_draft_snapshot(draft)
    draft.status = CONTENT_DRAFT_STATUS_PUBLISHED
    draft.active_key = None
    draft.published_page_id = page.id
    draft.published_version_id = version_record.id
    draft.published_by_user_id = current_user.id
    draft.published_at = version_record.published_at
    draft_after = _content_draft_snapshot(draft)
    record_audit_log(
        db,
        actor=current_user,
        action="content.draft.publish",
        resource_type="content_draft",
        resource_id=draft.id,
        event_result="success",
        request=request,
        snapshot={
            "draft": _change_snapshot(draft_before, draft_after),
            "page": {"before": page_before, "after": _content_page_snapshot(page)},
            "version": _content_page_version_snapshot(version_record),
        },
    )
    _commit_or_raise_publication_conflict(db)
    db.refresh(page)
    db.refresh(version_record)
    return _content_publication_read(page, version_record)


@router.patch("/drafts/{draft_id}/script-review", response_model=ContentDraftRead)
def review_content_draft_script(
    draft_id: int,
    payload: ContentDraftScriptReview,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ContentDraftRead:
    _require_admin(current_user)
    draft = _get_content_draft_for_transition(db, draft_id)
    if draft.status in {CONTENT_DRAFT_STATUS_WITHDRAWN, CONTENT_DRAFT_STATUS_PUBLISHED}:
        raise HTTPException(status_code=409, detail="Content draft is closed")
    if not draft.allow_script:
        raise HTTPException(status_code=409, detail="Content draft does not allow scripts")
    if draft.author_user_id == current_user.id or draft.last_editor_user_id == current_user.id:
        raise HTTPException(status_code=403, detail="Content draft authors and last editors cannot review their own scripts")
    draft_page_schema = ContentPage.model_validate(draft.schema_json)
    _reject_blocked_content_script_hosts(db, draft_page_schema, status_code=409)
    script_policy = _content_draft_script_policy(draft, verify_external_assets=payload.status == SCRIPT_REVIEW_APPROVED)
    if script_policy.has_blocking_findings:
        raise HTTPException(status_code=409, detail="Content draft script policy findings must be resolved before review")

    before = _content_draft_snapshot(draft)
    draft.script_risk_level = script_policy.risk_level
    draft.script_analysis_json = script_policy.to_json(schema_hash=draft.schema_hash)
    draft.script_review_status = payload.status
    draft.script_reviewed_by_user_id = current_user.id
    draft.script_reviewed_schema_hash = draft.schema_hash
    draft.script_reviewed_at = utc_now()
    draft.script_review_note = _strip_optional(payload.note)
    after = _content_draft_snapshot(draft)
    record_audit_log(
        db,
        actor=current_user,
        action=f"content.draft.script_review.{payload.status}",
        resource_type="content_draft",
        resource_id=draft.id,
        event_result="success",
        request=request,
        snapshot=_change_snapshot(before, after),
    )
    db.commit()
    db.refresh(draft)
    return _content_draft_read(draft)


@router.post("/page-versions/{version_id}/rollback", response_model=ContentPublicationRead)
def rollback_content_page_version(
    version_id: int,
    payload: ContentPageRollback,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ContentPublicationRead:
    _require_admin(current_user)
    target_version = db.get(ContentPageVersion, version_id)
    if target_version is None:
        raise HTTPException(status_code=404, detail="Content page version not found")
    _validate_content_slug(target_version.slug)
    page = db.scalar(
        select(ContentPageRecord)
        .where(ContentPageRecord.id == target_version.page_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if page is None:
        raise HTTPException(status_code=409, detail="Published content page is missing")
    target_script_policy = _analyze_content_script_policy(ContentPage.model_validate(target_version.schema_json))
    if target_script_policy.has_blocking_findings:
        raise HTTPException(status_code=409, detail="Content page version script policy findings must be resolved before rollback")
    _reject_blocked_content_script_hosts(db, ContentPage.model_validate(target_version.schema_json), status_code=409)
    if target_script_policy.findings:
        raise HTTPException(
            status_code=409,
            detail="Content page version includes script policy findings; create a reviewed draft before rollback",
        )

    previous_version = _current_content_page_version(db, target_version.slug)
    if previous_version is not None and previous_version.restored_from_version_id == target_version.id:
        raise HTTPException(status_code=409, detail="Content page is already restored from this version")
    page_before = _content_page_snapshot(page)
    version = _next_content_version(db, target_version.slug)
    page_schema = _published_page_schema(target_version.schema_json, target_version.slug, version)
    page.status = CONTENT_PAGE_STATUS_PUBLISHED
    page.version = version
    page.schema_json = page_schema.model_dump(mode="json")
    _flush_or_raise_publication_conflict(db)
    version_record = _new_content_page_version(
        db,
        page=page,
        page_schema=page_schema,
        publisher=current_user,
        note=payload.note,
        source_draft_id=None,
        restored_from_version_id=target_version.id,
        previous_version_id=previous_version.id if previous_version is not None else None,
    )
    page.schema_hash = version_record.schema_hash
    page.current_version_id = version_record.id
    page.published_by_user_id = current_user.id
    page.published_at = version_record.published_at
    record_audit_log(
        db,
        actor=current_user,
        action="content.page.rollback",
        resource_type="content_page",
        resource_id=page.id,
        event_result="success",
        request=request,
        snapshot={
            "page": {"before": page_before, "after": _content_page_snapshot(page)},
            "restored_from": _content_page_version_snapshot(target_version),
            "version": _content_page_version_snapshot(version_record),
        },
    )
    _commit_or_raise_publication_conflict(db)
    db.refresh(page)
    db.refresh(version_record)
    return _content_publication_read(page, version_record)


@router.get("/pages", response_model=list[dict])
def list_content_pages(db: Session = Depends(get_db)) -> list[dict]:
    return list_page_summaries(db)


@router.get("/pages/{slug:path}", response_model=ContentPage)
def read_content_page(slug: str, db: Session = Depends(get_db)) -> ContentPage:
    page = get_page_schema(db, slug)
    if page is None:
        raise HTTPException(status_code=404, detail="Content page not found")
    return page


def _require_content_author(user: User) -> None:
    if user.role not in {"admin", "teacher"}:
        raise HTTPException(status_code=403, detail="Teacher or admin role required")


def _require_admin(user: User) -> None:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")


def _require_draft_author_or_admin(draft: ContentDraft, user: User) -> None:
    if user.role == "admin":
        return
    if draft.author_user_id != user.id:
        raise HTTPException(status_code=403, detail="Content draft is outside your scope")
    _require_content_author(user)


def _get_content_draft_for_transition(db: Session, draft_id: int) -> ContentDraft:
    draft = db.scalar(select(ContentDraft).where(ContentDraft.id == draft_id).with_for_update())
    if draft is None:
        raise HTTPException(status_code=404, detail="Content draft not found")
    if draft.course_id is not None or draft.course_unit_id is not None:
        raise HTTPException(status_code=409, detail="课程内容请使用共享草稿与候选审核流程")
    return draft


def _validate_content_slug(slug: str) -> None:
    if slug.startswith("courses/"):
        raise HTTPException(status_code=409, detail="课程内容路径由课程发布流程管理")
    if (
        not slug
        or slug.startswith("/")
        or slug.endswith("/")
        or "\\" in slug
        or "//" in slug
        or any(part in {"", ".", ".."} for part in slug.split("/"))
    ):
        raise HTTPException(status_code=422, detail="Invalid content slug")


def _reject_blocked_content_script_hosts(db: Session, page_schema: ContentPage, *, status_code: int) -> None:
    blocked_policies = blocked_content_script_host_policies(db, page_schema)
    if not blocked_policies:
        return
    raise HTTPException(
        status_code=status_code,
        detail={
            "code": "content_script_host_blocked",
            "source_hosts": [policy.source_host for policy in blocked_policies],
        },
    )


def _content_draft_read(draft: ContentDraft) -> ContentDraftRead:
    return ContentDraftRead(
        id=draft.id,
        author_user_id=draft.author_user_id,
        last_editor_user_id=draft.last_editor_user_id,
        target_slug=draft.target_slug,
        title=draft.title,
        status=draft.status,
        allow_script=draft.allow_script,
        schema_hash=draft.schema_hash,
        base_version_id=draft.base_version_id,
        base_schema_hash=draft.base_schema_hash,
        script_risk_level=draft.script_risk_level,
        script_analysis=draft.script_analysis_json,
        script_review_status=draft.script_review_status,
        script_reviewed_by_user_id=draft.script_reviewed_by_user_id,
        script_reviewed_schema_hash=draft.script_reviewed_schema_hash,
        script_reviewed_at=draft.script_reviewed_at,
        script_review_note=draft.script_review_note,
        submitted_at=draft.submitted_at,
        withdrawn_at=draft.withdrawn_at,
        change_requested_by_user_id=draft.change_requested_by_user_id,
        change_requested_at=draft.change_requested_at,
        change_request_note=draft.change_request_note,
        published_page_id=draft.published_page_id,
        published_version_id=draft.published_version_id,
        published_by_user_id=draft.published_by_user_id,
        published_at=draft.published_at,
        page_schema=ContentPage.model_validate(draft.schema_json),
        created_at=draft.created_at,
        updated_at=draft.updated_at,
    )


def _content_publication_read(
    page: ContentPageRecord,
    version_record: ContentPageVersion,
) -> ContentPublicationRead:
    return ContentPublicationRead(
        id=page.id,
        slug=page.slug,
        title=str(page.schema_json.get("title", page.slug)),
        status=page.status,
        version=page.version,
        schema_hash=version_record.schema_hash,
        version_id=version_record.id,
        previous_version_id=version_record.previous_version_id,
        source_draft_id=version_record.source_draft_id,
        restored_from_version_id=version_record.restored_from_version_id,
        updated_at=page.updated_at,
    )


def _content_draft_snapshot(draft: ContentDraft) -> dict:
    return {
        "author_user_id": draft.author_user_id,
        "last_editor_user_id": draft.last_editor_user_id,
        "target_slug": draft.target_slug,
        "title": draft.title,
        "status": draft.status,
        "active_key": draft.active_key,
        "allow_script": draft.allow_script,
        "schema_hash": draft.schema_hash,
        "base_version_id": draft.base_version_id,
        "base_schema_hash": draft.base_schema_hash,
        "script_risk_level": draft.script_risk_level,
        "script_analysis": _content_draft_script_analysis_snapshot(draft),
        "script_review_status": draft.script_review_status,
        "script_reviewed_by_user_id": draft.script_reviewed_by_user_id,
        "script_reviewed_schema_hash": draft.script_reviewed_schema_hash,
        "script_reviewed_at": _isoformat(draft.script_reviewed_at),
        "script_review_note": draft.script_review_note,
        "submitted_at": _isoformat(draft.submitted_at),
        "withdrawn_at": _isoformat(draft.withdrawn_at),
        "change_requested_by_user_id": draft.change_requested_by_user_id,
        "change_requested_at": _isoformat(draft.change_requested_at),
        "change_request_note": draft.change_request_note,
        "published_page_id": draft.published_page_id,
        "published_version_id": draft.published_version_id,
        "published_by_user_id": draft.published_by_user_id,
        "published_at": _isoformat(draft.published_at),
    }


def _content_page_snapshot(page: ContentPageRecord) -> dict:
    return {
        "id": page.id,
        "slug": page.slug,
        "title": page.schema_json.get("title", page.slug),
        "status": page.status,
        "version": page.version,
        "schema_hash": page.schema_hash,
        "current_version_id": page.current_version_id,
        "published_by_user_id": page.published_by_user_id,
        "published_at": _isoformat(page.published_at),
    }


def _content_page_version_snapshot(version_record: ContentPageVersion) -> dict:
    return {
        "id": version_record.id,
        "page_id": version_record.page_id,
        "slug": version_record.slug,
        "title": version_record.schema_json.get("title", version_record.slug),
        "status": version_record.status,
        "version": version_record.version,
        "schema_hash": version_record.schema_hash,
        "previous_version_id": version_record.previous_version_id,
        "source_draft_id": version_record.source_draft_id,
        "restored_from_version_id": version_record.restored_from_version_id,
        "published_by_user_id": version_record.published_by_user_id,
        "note": version_record.note,
    }


def _published_page_schema(schema_json: dict, target_slug: str, version: str) -> ContentPage:
    page_schema = ContentPage.model_validate(schema_json)
    if page_schema.slug.strip() != target_slug:
        raise HTTPException(status_code=422, detail="target_slug must match schema.slug")
    normalized_schema = page_schema.model_copy(update={"slug": target_slug})
    return normalized_schema.model_copy(update={"status": CONTENT_PAGE_STATUS_PUBLISHED, "version": version})


def _new_content_page_version(
    db: Session,
    *,
    page: ContentPageRecord,
    page_schema: ContentPage,
    publisher: User,
    note: str | None,
    source_draft_id: int | None,
    restored_from_version_id: int | None,
    previous_version_id: int | None,
) -> ContentPageVersion:
    version_payload = page_schema.model_dump(mode="json")
    version_record = ContentPageVersion(
        page_id=page.id,
        slug=page.slug,
        status=page.status,
        version=page.version,
        schema_hash=_schema_hash(version_payload),
        schema_json=version_payload,
        source_draft_id=source_draft_id,
        restored_from_version_id=restored_from_version_id,
        previous_version_id=previous_version_id,
        published_by_user_id=publisher.id,
        published_at=utc_now(),
        note=_strip_optional(note),
    )
    db.add(version_record)
    _flush_or_raise_publication_conflict(db)
    return version_record


def _next_content_version(db: Session, slug: str) -> str:
    existing_versions = db.scalar(
        select(func.count()).select_from(ContentPageVersion).where(ContentPageVersion.slug == slug)
    )
    return f"v{int(existing_versions or 0) + 1}"


def _flush_or_raise_publication_conflict(db: Session) -> None:
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Content publication conflict; refresh the current version and retry",
        ) from exc


def _commit_or_raise_publication_conflict(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Content publication conflict; refresh the current version and retry",
        ) from exc


def _latest_content_page_version(db: Session, slug: str) -> ContentPageVersion | None:
    return db.scalar(
        select(ContentPageVersion)
        .where(ContentPageVersion.slug == slug)
        .order_by(ContentPageVersion.published_at.desc(), ContentPageVersion.id.desc())
        .limit(1)
    )


def _current_content_page_version(db: Session, slug: str) -> ContentPageVersion | None:
    page = db.scalar(select(ContentPageRecord).where(ContentPageRecord.slug == slug))
    if page is not None and page.current_version_id is not None:
        current_version = db.get(ContentPageVersion, page.current_version_id)
        if current_version is not None and current_version.slug == slug:
            return current_version
    return _latest_content_page_version(db, slug)


def _reject_stale_content_draft(db: Session, draft: ContentDraft) -> None:
    current_version = _current_content_page_version(db, draft.target_slug)
    if current_version is None:
        return
    if draft.base_version_id is not None:
        if current_version.id != draft.base_version_id:
            raise HTTPException(status_code=409, detail="Content draft is based on an older published version")
        if draft.base_schema_hash is not None and current_version.schema_hash != draft.base_schema_hash:
            raise HTTPException(status_code=409, detail="Content draft base schema hash is stale")
        return
    # New drafts created after a publication always persist base_version_id.
    # A missing base therefore means the draft predates the current page (or
    # is legacy data) and must fail closed without relying on DB timestamp
    # precision.
    raise HTTPException(status_code=409, detail="Content draft is based on an older published version")


def _content_draft_script_policy(draft: ContentDraft, *, verify_external_assets: bool = False):
    stored_analysis = draft.script_analysis_json if isinstance(draft.script_analysis_json, dict) else None
    stored_policy = script_policy_result_from_json(stored_analysis)
    stored_schema_hash = stored_analysis.get("schema_hash") if stored_analysis else None
    stored_policy_version = stored_analysis.get("policy_version") if stored_analysis else None
    stored_policy_context_hash = stored_analysis.get("policy_context_hash") if stored_analysis else None
    if (
        stored_policy is not None
        and stored_schema_hash == draft.schema_hash
        and stored_policy_version == SCRIPT_POLICY_VERSION
        and stored_policy_context_hash == _content_script_policy_context_hash()
        and not verify_external_assets
    ):
        return stored_policy
    return _analyze_content_script_policy(
        ContentPage.model_validate(draft.schema_json),
        verify_external_assets=verify_external_assets,
    )


def _analyze_content_script_policy(page_schema: ContentPage, *, verify_external_assets: bool = False):
    return analyze_content_script_policy(
        page_schema,
        allowed_external_hosts=get_settings().content_script_allowed_host_list,
        verify_external_assets=verify_external_assets,
    )


def _validate_content_stable_identity_contract(page_schema: ContentPage, *, status_code: int = 422) -> None:
    errors = content_stable_identity_errors(page_schema)
    if errors:
        raise HTTPException(
            status_code=status_code,
            detail={
                "code": "content_stable_identity_required",
                "errors": errors,
            },
        )


def _content_script_policy_context_hash() -> str:
    return script_policy_context_hash(
        allowed_external_hosts=get_settings().content_script_allowed_host_list,
    )


def _content_draft_script_analysis_snapshot(draft: ContentDraft) -> dict | None:
    policy = _content_draft_script_policy(draft)
    if policy is None:
        return None
    return {
        "policy_version": policy.policy_version,
        "policy_context_hash": policy.policy_context_hash,
        "schema_hash": draft.schema_hash,
        "status": policy.status,
        "risk_level": policy.risk_level,
        "finding_count": len(policy.findings),
        "sandbox": policy.sandbox,
        "findings": [finding.to_dict() for finding in policy.findings],
    }


def _schema_hash(payload: dict) -> str:
    serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _change_snapshot(before: dict, after: dict) -> dict:
    changes = {
        key: {"from": before.get(key), "to": after.get(key)}
        for key in sorted(set(before) | set(after))
        if before.get(key) != after.get(key)
    }
    return {"before": before, "after": after, "changes": changes}


def _transition_snapshot(before: dict, after: dict, note: str | None) -> dict:
    snapshot = _change_snapshot(before, after)
    stripped_note = _strip_optional(note)
    if stripped_note is not None:
        snapshot["note"] = stripped_note
    return snapshot


def _isoformat(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat()


def _strip_optional(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip() or None


def _strip_required(value: str) -> str:
    stripped = value.strip()
    if not stripped:
        raise HTTPException(status_code=422, detail="Note is required")
    return stripped
