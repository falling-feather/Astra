"""Shared course draft and immutable release application service."""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from typing import Any

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    ClassGroup,
    ContentDraft,
    ContentPageRecord,
    ContentPageVersion,
    Course,
    CourseClass,
    CourseClassReleaseBinding,
    CourseEnrollment,
    CourseRelease,
    CourseReleaseUnit,
    CourseUnit,
    LearningCompletionRule,
    LearningRuleActivation,
    User,
)
from app.models.base import utc_now
from app.schemas.content_platform import (
    CourseReleasePublish,
    CourseSharedDraftReplace,
    CourseSharedDraftUnitWrite,
)
from app.schemas.content_v2 import ContentPageV2, CourseUnitRefV2
from app.services.access_control import (
    get_course,
    lock_course_for_write,
    require_course_editor_or_admin,
)
from app.services.audit import record_audit_log

COURSE_RELEASE_SCHEMA_VERSION = "astra-course-release-v2"
SHARED_DRAFT_ACTIVE_KEY = "shared"


class ContentPlatformError(Exception):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def get_course_draft(
    db: Session,
    *,
    actor: User,
    course_id: int,
) -> dict[str, Any]:
    course = get_course(db, course_id)
    require_course_editor_or_admin(
        db,
        actor,
        course,
        detail="Shared course draft requires an active course teacher",
    )
    return _shared_draft_read(db, course)


def replace_course_draft(
    db: Session,
    *,
    actor: User,
    course_id: int,
    payload: CourseSharedDraftReplace,
    request: Request,
) -> dict[str, Any]:
    course_hint = get_course(db, course_id)
    require_course_editor_or_admin(
        db,
        actor,
        course_hint,
        detail="Shared course draft requires an active course teacher",
    )
    course = lock_course_for_write(db, course_id)
    require_course_editor_or_admin(
        db,
        actor,
        course,
        detail="Shared course draft requires an active course teacher",
    )
    if course.status != "published":
        raise ContentPlatformError(
            409,
            "course_not_approved",
            "Course content can be edited after course information approval",
        )
    if payload.expected_revision != course.content_draft_revision:
        raise ContentPlatformError(
            409,
            "course_draft_revision_conflict",
            f"Shared draft changed; current revision is {course.content_draft_revision}",
        )

    existing_units = list(
        db.scalars(
            select(CourseUnit)
            .where(CourseUnit.course_id == course.id)
            .order_by(CourseUnit.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).all()
    )
    existing_by_id = {unit.id: unit for unit in existing_units}
    requested_ids = {item.id for item in payload.units if item.id is not None}
    unknown_ids = sorted(requested_ids.difference(existing_by_id))
    if unknown_ids:
        raise ContentPlatformError(
            422,
            "course_draft_unit_scope_mismatch",
            f"Draft unit does not belong to this course: {unknown_ids[0]}",
        )

    # Free the position uniqueness slots before an atomic reorder.
    for unit in existing_units:
        unit.position = -(1_000_000 + unit.id)
    if existing_units:
        db.flush()

    next_revision = course.content_draft_revision + 1
    retained_ids: set[int] = set()
    for item in sorted(
        payload.units, key=lambda value: (value.position, value.activity_key)
    ):
        unit = existing_by_id.get(item.id) if item.id is not None else None
        if unit is None:
            unit = CourseUnit(
                course_id=course.id,
                activity_key=item.activity_key,
                title=item.title,
                position=item.position,
                content_slug=_canonical_content_slug(course.id, item.activity_key),
                status="draft",
            )
            db.add(unit)
            db.flush()
        else:
            unit.activity_key = item.activity_key
            unit.title = item.title
            unit.position = item.position
            unit.content_slug = _canonical_content_slug(course.id, item.activity_key)
            unit.status = "draft"
            db.flush()
        retained_ids.add(unit.id)
        content = _canonical_draft_content(
            course=course,
            unit=unit,
            item=item,
            revision=next_revision,
        )
        _upsert_shared_content_draft(
            db,
            actor=actor,
            course=course,
            unit=unit,
            content=content,
            revision=next_revision,
        )

    removed_units = [unit for unit in existing_units if unit.id not in retained_ids]
    for unit in removed_units:
        unit.status = "archived"
        draft = _active_shared_draft(db, unit.id, locking_read=True)
        if draft is not None:
            draft.status = "withdrawn"
            draft.active_key = None
            draft.withdrawn_at = utc_now()

    before_revision = course.content_draft_revision
    course.content_draft_revision = next_revision
    course.updated_at = utc_now()
    record_audit_log(
        db,
        actor=actor,
        action="course.shared_draft.replace",
        resource_type="course",
        resource_id=course.id,
        school_id=course.school_id,
        event_result="success",
        request=request,
        snapshot={
            "before": {"revision": before_revision, "unit_count": len(existing_units)},
            "after": {
                "revision": next_revision,
                "unit_count": len(payload.units),
                "archived_unit_count": len(removed_units),
                "last_editor_user_id": actor.id,
            },
        },
    )
    _commit_or_conflict(
        db,
        "course_draft_write_conflict",
        "Shared course draft changed concurrently",
    )
    db.refresh(course)
    return _shared_draft_read(db, course)


def list_course_releases(
    db: Session,
    *,
    actor: User,
    course_id: int,
) -> list[dict[str, Any]]:
    course = get_course(db, course_id)
    require_course_editor_or_admin(
        db,
        actor,
        course,
        detail="Course release history requires an active course teacher",
    )
    releases = list(
        db.scalars(
            select(CourseRelease)
            .where(CourseRelease.course_id == course.id)
            .order_by(CourseRelease.release_number.desc(), CourseRelease.id.desc())
        ).all()
    )
    return [
        _course_release_read(db, release, include_answers=True) for release in releases
    ]


def get_course_release(
    db: Session,
    *,
    actor: User,
    course_id: int,
    release_id: int,
) -> dict[str, Any]:
    course = get_course(db, course_id)
    include_answers = _require_release_reader(db, actor=actor, course=course)
    release = db.scalar(
        select(CourseRelease).where(
            CourseRelease.id == release_id,
            CourseRelease.course_id == course.id,
        )
    )
    if release is None:
        raise ContentPlatformError(
            404, "course_release_not_found", "Course release not found"
        )
    return _course_release_read(db, release, include_answers=include_answers)


def create_course_release(
    db: Session,
    *,
    actor: User,
    course_id: int,
    payload: CourseReleasePublish,
    request: Request,
) -> dict[str, Any]:
    course_hint = get_course(db, course_id)
    require_course_editor_or_admin(
        db,
        actor,
        course_hint,
        detail="Course publication requires an active course teacher",
    )
    course = lock_course_for_write(db, course_id)
    require_course_editor_or_admin(
        db,
        actor,
        course,
        detail="Course publication requires an active course teacher",
    )
    if course.status != "published":
        raise ContentPlatformError(
            409,
            "course_not_approved",
            "Course information must be approved before content publication",
        )
    if payload.expected_revision != course.content_draft_revision:
        raise ContentPlatformError(
            409,
            "course_draft_revision_conflict",
            f"Shared draft changed; current revision is {course.content_draft_revision}",
        )

    units = list(
        db.scalars(
            select(CourseUnit)
            .where(
                CourseUnit.course_id == course.id,
                CourseUnit.status != "archived",
            )
            .order_by(CourseUnit.position, CourseUnit.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).all()
    )
    if not units:
        raise ContentPlatformError(
            409,
            "course_draft_empty",
            "Shared course draft must contain at least one unit before publication",
        )

    release_number = (
        int(
            db.scalar(
                select(func.max(CourseRelease.release_number)).where(
                    CourseRelease.course_id == course.id
                )
            )
            or 0
        )
        + 1
    )
    rule_id, rule_sha256, rule_snapshot = _completion_rule_snapshot(db, course.id)
    specs = [
        _release_unit_spec(
            db,
            course=course,
            unit=unit,
            release_number=release_number,
            expected_revision=payload.expected_revision,
        )
        for unit in units
    ]
    package_sha256 = _course_package_sha256(
        course=course,
        completion_rule_sha256=rule_sha256,
        specs=specs,
    )
    duplicate_release_id = db.scalar(
        select(CourseRelease.id).where(
            CourseRelease.course_id == course.id,
            CourseRelease.package_sha256 == package_sha256,
        )
    )
    if duplicate_release_id is not None:
        raise ContentPlatformError(
            409,
            "course_release_unchanged",
            "Current shared draft is identical to an existing release",
        )

    published_at = utc_now()
    release = CourseRelease(
        course_id=course.id,
        release_number=release_number,
        draft_revision=payload.expected_revision,
        schema_version=COURSE_RELEASE_SCHEMA_VERSION,
        status="published",
        title_snapshot=course.title,
        summary_snapshot=course.summary,
        completion_rule_id=rule_id,
        completion_rule_sha256=rule_sha256,
        completion_rule_snapshot=rule_snapshot,
        package_sha256=package_sha256,
        published_by_user_id=actor.id,
        published_at=published_at,
    )
    db.add(release)
    db.flush()

    next_draft_revision = course.content_draft_revision + 1
    for spec in specs:
        page, version = _publish_content_page(
            db,
            actor=actor,
            draft=spec["draft"],
            published_content=spec["published_content"],
            schema_sha256=spec["schema_sha256"],
            note=payload.note,
            published_at=published_at,
        )
        release_unit = CourseReleaseUnit(
            course_release_id=release.id,
            source_course_unit_id=spec["unit"].id,
            activity_key=spec["unit"].activity_key,
            title_snapshot=spec["unit"].title,
            position=spec["unit"].position,
            content_slug=page.slug,
            content_page_version_id=version.id,
            content_schema_sha256=version.schema_hash,
            media_snapshot_json=spec["media_snapshot"],
        )
        db.add(release_unit)
        _roll_shared_draft_forward(
            db,
            actor=actor,
            course=course,
            unit=spec["unit"],
            published_draft=spec["draft"],
            published_version=version,
            next_revision=next_draft_revision,
        )

    course_class = _internal_course_class(db, course.id, locking_read=True)
    current_binding = db.scalar(
        select(CourseClassReleaseBinding)
        .where(CourseClassReleaseBinding.course_class_id == course_class.id)
        .order_by(
            CourseClassReleaseBinding.binding_revision.desc(),
            CourseClassReleaseBinding.id.desc(),
        )
        .limit(1)
        .with_for_update()
    )
    binding = CourseClassReleaseBinding(
        course_class_id=course_class.id,
        course_release_id=release.id,
        binding_revision=(
            current_binding.binding_revision + 1 if current_binding else 1
        ),
        previous_binding_id=current_binding.id if current_binding else None,
        bound_by_user_id=actor.id,
        binding_reason="course publish",
        bound_at=published_at,
    )
    db.add(binding)
    db.flush()

    course.content_draft_revision = next_draft_revision
    course.updated_at = published_at
    record_audit_log(
        db,
        actor=actor,
        action="course.release.publish",
        resource_type="course_release",
        resource_id=release.id,
        school_id=course.school_id,
        class_id=course_class.class_id,
        event_result="success",
        request=request,
        snapshot={
            "before": {
                "draft_revision": payload.expected_revision,
                "binding_id": current_binding.id if current_binding else None,
                "binding_revision": current_binding.binding_revision
                if current_binding
                else 0,
            },
            "after": {
                "release_number": release.release_number,
                "package_sha256": release.package_sha256,
                "unit_count": len(specs),
                "binding_id": binding.id,
                "binding_revision": binding.binding_revision,
                "next_draft_revision": next_draft_revision,
            },
        },
    )
    _commit_or_conflict(
        db,
        "course_release_conflict",
        "Course release changed concurrently; no partial release was retained",
    )
    db.refresh(release)
    db.refresh(binding)
    return {
        "release": _course_release_read(db, release, include_answers=True),
        "binding": _binding_read(binding),
        "next_draft_revision": next_draft_revision,
    }


def get_current_course_release(
    db: Session,
    *,
    actor: User,
    course_id: int,
) -> dict[str, Any]:
    course = get_course(db, course_id)
    include_answers = _require_release_reader(db, actor=actor, course=course)
    course_class = _internal_course_class(db, course.id, locking_read=False)
    binding = db.scalar(
        select(CourseClassReleaseBinding)
        .where(CourseClassReleaseBinding.course_class_id == course_class.id)
        .order_by(
            CourseClassReleaseBinding.binding_revision.desc(),
            CourseClassReleaseBinding.id.desc(),
        )
        .limit(1)
    )
    if binding is None:
        raise ContentPlatformError(
            404,
            "course_release_not_published",
            "Course has no published content release",
        )
    release = db.get(CourseRelease, binding.course_release_id)
    if release is None or release.course_id != course.id:
        raise ContentPlatformError(
            409,
            "course_release_binding_invalid",
            "Current course release binding is invalid",
        )
    return {
        "binding": _binding_read(binding),
        "release": _course_release_read(db, release, include_answers=include_answers),
    }


def _shared_draft_read(db: Session, course: Course) -> dict[str, Any]:
    units = list(
        db.scalars(
            select(CourseUnit)
            .where(
                CourseUnit.course_id == course.id,
                CourseUnit.status != "archived",
            )
            .order_by(CourseUnit.position, CourseUnit.id)
        ).all()
    )
    items: list[dict[str, Any]] = []
    for unit in units:
        draft = _active_shared_draft(db, unit.id, locking_read=False)
        content = (
            ContentPageV2.model_validate(draft.schema_json)
            if draft is not None
            else None
        )
        items.append(
            {
                "id": unit.id,
                "content_draft_id": draft.id if draft is not None else None,
                "revision": draft.revision
                if draft is not None
                else course.content_draft_revision,
                "activity_key": unit.activity_key,
                "title": unit.title,
                "position": unit.position,
                "content_slug": unit.content_slug,
                "content_schema_sha256": draft.schema_hash
                if draft is not None
                else None,
                "last_editor_user_id": draft.last_editor_user_id
                if draft is not None
                else None,
                "content": content,
            }
        )
    return {
        "course_id": course.id,
        "revision": course.content_draft_revision,
        "status": course.status,
        "title": course.title,
        "summary": course.summary,
        "updated_at": course.updated_at,
        "units": items,
    }


def _canonical_draft_content(
    *,
    course: Course,
    unit: CourseUnit,
    item: CourseSharedDraftUnitWrite,
    revision: int,
) -> ContentPageV2:
    return item.content.model_copy(
        update={
            "slug": _canonical_content_slug(course.id, item.activity_key),
            "galaxy": course.galaxy_key,
            "subject": course.subject_key,
            "title": item.title,
            "status": "draft",
            "version": f"draft-r{revision}",
            "courseUnit": CourseUnitRefV2(
                courseId=course.course_key,
                unitId=item.activity_key,
                order=item.position,
                title=item.title,
            ),
        }
    )


def _upsert_shared_content_draft(
    db: Session,
    *,
    actor: User,
    course: Course,
    unit: CourseUnit,
    content: ContentPageV2,
    revision: int,
) -> ContentDraft:
    payload = content.model_dump(mode="json")
    schema_hash = _canonical_sha256(payload)
    draft = _active_shared_draft(db, unit.id, locking_read=True)
    if draft is None:
        draft = ContentDraft(
            course_id=course.id,
            course_unit_id=unit.id,
            revision=revision,
            author_user_id=actor.id,
            last_editor_user_id=actor.id,
            target_slug=content.slug,
            title=unit.title,
            status="draft",
            active_key=SHARED_DRAFT_ACTIVE_KEY,
            schema_json=payload,
            schema_hash=schema_hash,
            allow_script=False,
            script_risk_level="none",
            script_review_status="not_required",
        )
        db.add(draft)
    else:
        if draft.course_id != course.id:
            raise ContentPlatformError(
                409,
                "shared_draft_scope_invalid",
                "Shared draft course scope is invalid",
            )
        draft.revision = revision
        draft.last_editor_user_id = actor.id
        draft.target_slug = content.slug
        draft.title = unit.title
        draft.status = "draft"
        draft.schema_json = payload
        draft.schema_hash = schema_hash
        draft.allow_script = False
    db.flush()
    return draft


def _release_unit_spec(
    db: Session,
    *,
    course: Course,
    unit: CourseUnit,
    release_number: int,
    expected_revision: int,
) -> dict[str, Any]:
    draft = _active_shared_draft(db, unit.id, locking_read=True)
    if draft is None or draft.course_id != course.id:
        raise ContentPlatformError(
            409,
            "course_unit_draft_missing",
            f"Course unit {unit.id} has no shared draft",
        )
    if draft.revision != expected_revision:
        raise ContentPlatformError(
            409,
            "course_unit_draft_revision_conflict",
            f"Course unit {unit.id} is not at shared revision {expected_revision}",
        )
    draft_content = ContentPageV2.model_validate(draft.schema_json)
    published_content = draft_content.model_copy(
        update={
            "status": "published",
            "version": f"course-{course.id}-release-{release_number}",
        }
    )
    published_payload = published_content.model_dump(mode="json")
    package_payload = deepcopy(published_payload)
    package_payload["version"] = "release"
    return {
        "unit": unit,
        "draft": draft,
        "published_content": published_content,
        "schema_sha256": _canonical_sha256(published_payload),
        "package_schema_sha256": _canonical_sha256(package_payload),
        "media_snapshot": _media_snapshot(published_payload),
    }


def _publish_content_page(
    db: Session,
    *,
    actor: User,
    draft: ContentDraft,
    published_content: ContentPageV2,
    schema_sha256: str,
    note: str | None,
    published_at,
) -> tuple[ContentPageRecord, ContentPageVersion]:
    payload = published_content.model_dump(mode="json")
    page = db.scalar(
        select(ContentPageRecord)
        .where(ContentPageRecord.slug == published_content.slug)
        .with_for_update()
    )
    previous_version_id = page.current_version_id if page is not None else None
    if page is None:
        page = ContentPageRecord(
            slug=published_content.slug,
            status="published",
            version=published_content.version,
            schema_json=payload,
            schema_hash=schema_sha256,
            published_by_user_id=actor.id,
            published_at=published_at,
        )
        db.add(page)
        db.flush()
    version = ContentPageVersion(
        page_id=page.id,
        slug=page.slug,
        status="published",
        version=published_content.version,
        schema_hash=schema_sha256,
        schema_json=payload,
        source_draft_id=draft.id,
        restored_from_version_id=None,
        previous_version_id=previous_version_id,
        published_by_user_id=actor.id,
        published_at=published_at,
        note=note,
    )
    db.add(version)
    db.flush()
    page.status = "published"
    page.version = version.version
    page.schema_json = payload
    page.schema_hash = schema_sha256
    page.current_version_id = version.id
    page.published_by_user_id = actor.id
    page.published_at = published_at
    return page, version


def _roll_shared_draft_forward(
    db: Session,
    *,
    actor: User,
    course: Course,
    unit: CourseUnit,
    published_draft: ContentDraft,
    published_version: ContentPageVersion,
    next_revision: int,
) -> None:
    published_draft.status = "published"
    published_draft.active_key = None
    published_draft.published_page_id = published_version.page_id
    published_draft.published_version_id = published_version.id
    published_draft.published_by_user_id = actor.id
    published_draft.published_at = published_version.published_at
    db.flush()

    published_content = ContentPageV2.model_validate(published_version.schema_json)
    next_content = published_content.model_copy(
        update={"status": "draft", "version": f"draft-r{next_revision}"}
    )
    next_payload = next_content.model_dump(mode="json")
    db.add(
        ContentDraft(
            course_id=course.id,
            course_unit_id=unit.id,
            revision=next_revision,
            author_user_id=actor.id,
            last_editor_user_id=actor.id,
            target_slug=published_version.slug,
            title=unit.title,
            status="draft",
            active_key=SHARED_DRAFT_ACTIVE_KEY,
            schema_json=next_payload,
            schema_hash=_canonical_sha256(next_payload),
            base_version_id=published_version.id,
            base_schema_hash=published_version.schema_hash,
            allow_script=False,
            script_risk_level="none",
            script_review_status="not_required",
        )
    )


def _completion_rule_snapshot(
    db: Session,
    course_id: int,
) -> tuple[int | None, str, dict[str, Any]]:
    activation = db.scalar(
        select(LearningRuleActivation).where(
            LearningRuleActivation.course_id == course_id
        )
    )
    if activation is None:
        snapshot: dict[str, Any] = {"preset": "not_configured", "version": 0}
        return None, _canonical_sha256(snapshot), snapshot
    rule = db.get(LearningCompletionRule, activation.active_rule_id)
    if rule is None or rule.course_id != course_id:
        raise ContentPlatformError(
            409,
            "course_completion_rule_invalid",
            "Active course completion rule is invalid",
        )
    snapshot = {
        "rule_id": rule.id,
        "version": rule.version_number,
        "definition": deepcopy(rule.definition_json),
    }
    return rule.id, rule.definition_sha256, snapshot


def _course_package_sha256(
    *,
    course: Course,
    completion_rule_sha256: str,
    specs: list[dict[str, Any]],
) -> str:
    return _canonical_sha256(
        {
            "schema_version": COURSE_RELEASE_SCHEMA_VERSION,
            "course_id": course.id,
            "title": course.title,
            "summary": course.summary,
            "completion_rule_sha256": completion_rule_sha256,
            "units": [
                {
                    "activity_key": spec["unit"].activity_key,
                    "title": spec["unit"].title,
                    "position": spec["unit"].position,
                    "content_slug": spec["published_content"].slug,
                    "content_schema_sha256": spec["package_schema_sha256"],
                    "media_snapshot": spec["media_snapshot"],
                }
                for spec in specs
            ],
        }
    )


def _course_release_read(
    db: Session,
    release: CourseRelease,
    *,
    include_answers: bool,
) -> dict[str, Any]:
    rows = list(
        db.scalars(
            select(CourseReleaseUnit)
            .where(CourseReleaseUnit.course_release_id == release.id)
            .order_by(CourseReleaseUnit.position, CourseReleaseUnit.id)
        ).all()
    )
    units: list[dict[str, Any]] = []
    for row in rows:
        version = db.get(ContentPageVersion, row.content_page_version_id)
        if version is None:
            raise ContentPlatformError(
                409,
                "course_release_content_missing",
                "Published course content version is missing",
            )
        content = deepcopy(version.schema_json)
        if not include_answers:
            content = _public_content_page(content)
        units.append(
            {
                "id": row.id,
                "source_course_unit_id": row.source_course_unit_id,
                "activity_key": row.activity_key,
                "title": row.title_snapshot,
                "position": row.position,
                "content_slug": row.content_slug,
                "content_page_version_id": row.content_page_version_id,
                "content_schema_sha256": row.content_schema_sha256,
                "media_snapshot": deepcopy(row.media_snapshot_json or []),
                "content": content,
            }
        )
    return {
        "id": release.id,
        "course_id": release.course_id,
        "release_number": release.release_number,
        "draft_revision": release.draft_revision,
        "schema_version": release.schema_version,
        "title": release.title_snapshot,
        "summary": release.summary_snapshot,
        "completion_rule_id": release.completion_rule_id,
        "completion_rule_sha256": release.completion_rule_sha256,
        "package_sha256": release.package_sha256,
        "published_by_user_id": release.published_by_user_id,
        "published_at": release.published_at,
        "units": units,
    }


def _require_release_reader(db: Session, *, actor: User, course: Course) -> bool:
    if actor.role in {"teacher", "admin"}:
        require_course_editor_or_admin(
            db,
            actor,
            course,
            detail="Course release is outside current teacher scope",
        )
        return True
    if actor.role != "student" or course.status != "published":
        raise ContentPlatformError(
            403, "course_release_forbidden", "Course release is unavailable"
        )
    enrollment = db.scalar(
        select(CourseEnrollment.id).where(
            CourseEnrollment.course_id == course.id,
            CourseEnrollment.student_id == actor.id,
            CourseEnrollment.status == "active",
        )
    )
    if enrollment is None:
        raise ContentPlatformError(
            403,
            "course_enrollment_required",
            "Active course enrollment is required",
        )
    return False


def _internal_course_class(
    db: Session,
    course_id: int,
    *,
    locking_read: bool,
) -> CourseClass:
    statement = (
        select(CourseClass)
        .join(ClassGroup, ClassGroup.id == CourseClass.class_id)
        .where(
            CourseClass.course_id == course_id,
            CourseClass.status == "active",
            ClassGroup.kind == "course_cohort",
            ClassGroup.status == "active",
        )
        .order_by(CourseClass.id)
    )
    if locking_read:
        statement = statement.with_for_update()
    rows = list(db.scalars(statement).all())
    if len(rows) != 1:
        raise ContentPlatformError(
            409,
            "course_internal_scope_invalid",
            "Course internal teaching scope is unavailable",
        )
    return rows[0]


def _active_shared_draft(
    db: Session,
    course_unit_id: int,
    *,
    locking_read: bool,
) -> ContentDraft | None:
    statement = select(ContentDraft).where(
        ContentDraft.course_unit_id == course_unit_id,
        ContentDraft.active_key == SHARED_DRAFT_ACTIVE_KEY,
    )
    if locking_read:
        statement = statement.with_for_update()
    return db.scalar(statement)


def _binding_read(binding: CourseClassReleaseBinding) -> dict[str, Any]:
    return {
        "id": binding.id,
        "course_class_id": binding.course_class_id,
        "course_release_id": binding.course_release_id,
        "binding_revision": binding.binding_revision,
        "previous_binding_id": binding.previous_binding_id,
        "bound_by_user_id": binding.bound_by_user_id,
        "binding_reason": binding.binding_reason,
        "bound_at": binding.bound_at,
    }


def _public_content_page(content: dict[str, Any]) -> dict[str, Any]:
    public = deepcopy(content)
    for block in public.get("blocks", []):
        if not isinstance(block, dict) or block.get("type") != "checkpoint":
            continue
        block.pop("correctChoiceIds", None)
        block.pop("numericAnswer", None)
        block.pop("tolerance", None)
        block.pop("acceptedAnswers", None)
    return public


def _media_snapshot(content: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "block_id": block.get("blockId"),
            "asset_key": block.get("assetKey"),
            "media_type": block.get("mediaType"),
            "alt": block.get("alt"),
            "caption": block.get("caption"),
        }
        for block in content.get("blocks", [])
        if isinstance(block, dict) and block.get("type") == "media"
    ]


def _canonical_content_slug(course_id: int, activity_key: str) -> str:
    return f"courses/{course_id}/{activity_key}"


def _canonical_sha256(value: Any) -> str:
    payload = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _commit_or_conflict(db: Session, code: str, message: str) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ContentPlatformError(409, code, message) from exc
