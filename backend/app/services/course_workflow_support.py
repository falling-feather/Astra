"""Shared authorization, immutable receipts and snapshots for course v2 use cases."""
from __future__ import annotations

from copy import deepcopy

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.learning_evidence_contract import canonical_sha256
from app.models import Course, CourseFamily, CourseRevision, CourseUnit, CourseWorkflowOperation, User
from app.schemas.course_workflow import CourseSettings
from app.services import content_platform, course_authoring
from app.services.access_control import get_course, lock_course_for_write, require_course_editor_or_admin, require_school_teacher_or_admin
from app.services.learning_resources import get_resource_version, spaces_manifest


def authoring_course(db: Session, actor: User, course_id: int, *, write: bool = False, owner: bool = False) -> Course:
    course = get_course(db, course_id)
    school = require_school_teacher_or_admin(db, actor, course.school_id)
    if actor.role != "admin" and school.status != "active":
        raise HTTPException(status_code=403, detail="学校当前未开放")
    if write and actor.role != "teacher":
        raise HTTPException(status_code=403, detail="课程创作与发布由授课教师操作")
    require_course_editor_or_admin(db, actor, course)
    if owner and course.creator_user_id != actor.id:
        raise HTTPException(status_code=403, detail="跨课程操作仅限本人名下课程")
    if write:
        course_authoring._lock_authoring_teacher(db, actor, course.school_id)
        course = lock_course_for_write(db, course_id)
        require_course_editor_or_admin(db, actor, course)
        if owner and course.creator_user_id != actor.id:
            raise HTTPException(status_code=403, detail="课程归属已变化")
        if course.status == "archived":
            raise HTTPException(status_code=409, detail="课程已归档，请先恢复课程")
        # SELECT FOR UPDATE does not lock SQLite rows. The conditional write also
        # gives SQLite a write transaction before snapshot-dependent decisions.
        locked = db.execute(update(Course).where(Course.id == course.id, Course.content_draft_revision == course.content_draft_revision).values(content_draft_revision=Course.content_draft_revision, updated_at=Course.updated_at))
        if locked.rowcount != 1:
            raise HTTPException(status_code=409, detail="课程已被其他操作修改，请重新读取")
    return course


def normalized_settings(settings: CourseSettings) -> dict:
    value = settings.model_dump(mode="json")
    value["collaborator_user_ids"] = sorted(value["collaborator_user_ids"])
    value["admission_class_ids"] = sorted(value["admission_class_ids"])
    return value


def current_settings(db: Session, course: Course, *, data: dict | None = None) -> dict:
    if course.draft_settings_json is not None:
        return deepcopy(course.draft_settings_json)
    data = data or course_authoring.build_course_draft_read(db, course)
    information = data["information_revision"].information_snapshot
    return normalized_settings(CourseSettings.model_validate({
        **information, "school_id": course.school_id,
        "collaborator_user_ids": [teacher["user_id"] for teacher in data["teachers"] if not teacher["is_creator"]],
        "admission_class_ids": [group["class_id"] for group in data["admission_classes"]],
        "level_key": course.level_key,
    }))


def validate_settings(db: Session, actor: User, settings: CourseSettings, *, course: Course | None = None) -> dict:
    if course is not None and settings.school_id != course.school_id:
        raise HTTPException(status_code=422, detail="课程所属学校不可更换")
    manifest = spaces_manifest()
    if settings.galaxy_key not in {space["key"] for space in manifest["spaces"]}:
        raise HTTPException(status_code=422, detail="学习空间尚未登记")
    if settings.level_key is not None and settings.level_key not in {level["key"] for level in manifest["levels"]}:
        raise HTTPException(status_code=422, detail="学习层次尚未登记")
    creator_id = course.creator_user_id if course else actor.id
    if creator_id in settings.collaborator_user_ids:
        raise HTTPException(status_code=422, detail="课程创建者不应重复列为共同教师")
    course_authoring._load_eligible_collaborators(db, school_id=settings.school_id, user_ids=settings.collaborator_user_ids)
    course_authoring._load_admission_classes(db, school_id=settings.school_id, class_ids=settings.admission_class_ids)
    normalized = normalized_settings(settings)
    if course is not None and creator_id != actor.id and normalized != current_settings(db, course):
        raise HTTPException(status_code=403, detail="共同教师可编辑内容，课程资料与准入设置由创建者调整")
    return normalized


def ensure_lineage(db: Session, course: Course, *, family_id: int | None = None) -> None:
    if course.family_id is None:
        if family_id is None:
            family = CourseFamily(school_id=course.school_id, created_by_user_id=course.creator_user_id)
            db.add(family)
            db.flush()
            family_id = family.id
        else:
            family = db.get(CourseFamily, family_id)
            if family is None or family.school_id != course.school_id:
                raise HTTPException(status_code=422, detail="课程来源不属于当前学校")
        course.family_id = family_id


def adopt_workflow(db: Session, course: Course) -> None:
    if course.workflow_generation == 2:
        return
    information = course_authoring._latest_information_revision(db, course.id)
    if information is not None and information.status == "submitted":
        raise HTTPException(status_code=409, detail="请先处理已有课程资料审核，再进入新的版本流程")
    course.draft_settings_json = current_settings(db, course)
    course.workflow_generation = 2
    ensure_lineage(db, course)


def replay_operation(db: Session, actor: User, kind: str, key: str, request: dict) -> dict | None:
    existing = db.scalar(select(CourseWorkflowOperation).where(CourseWorkflowOperation.actor_user_id == actor.id, CourseWorkflowOperation.client_request_id == key))
    if existing is None:
        return None
    if existing.operation_kind != kind or existing.request_sha256 != canonical_sha256(request):
        raise HTTPException(status_code=409, detail={"code": "workflow_request_conflict", "message": "该请求编号已经用于不同操作，请重新读取状态"})
    return deepcopy(existing.receipt_json)


def finish_operation(db: Session, actor: User, kind: str, key: str, request: dict, response: dict, *, scope: dict) -> dict:
    from app.schemas import course_workflow as dto
    response_types = {
        "course.create": dto.CourseWorkflowRead, "course.draft.save": dto.CourseDraftReadV2,
        "course.fork": dto.CourseForkRead, "course.submit": dto.SubmissionReceiptRead,
        "course.review": dto.ReviewReceiptRead, "course.withdraw": dto.CandidateActionRead,
        "course.publish": dto.PublicationReceiptRead, "course.restore": dto.CourseDraftReadV2,
    }
    # Store the exact public result, including canonical datetime encoding. A
    # receipt and a repeated HTTP response must have identical meaning and shape.
    encoded = response_types[kind].model_validate(response).model_dump(mode="json")
    db.add(CourseWorkflowOperation(actor_user_id=actor.id, operation_kind=kind, scope_json=scope, client_request_id=key, request_sha256=canonical_sha256(request), receipt_json=encoded))
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        # Re-enter the use case to repeat authorization before reading a competing receipt.
        raise HTTPException(status_code=409, detail={"code": "workflow_write_conflict", "message": "数据已被其他操作修改，请重新读取；若操作已生效，可用同一请求编号回读结果"}) from exc
    return encoded


def read_operation(db: Session, *, actor: User, client_request_id: str) -> dict:
    operation = db.scalar(select(CourseWorkflowOperation).where(CourseWorkflowOperation.actor_user_id == actor.id, CourseWorkflowOperation.client_request_id == client_request_id))
    if operation is None:
        raise HTTPException(status_code=404, detail="尚未找到这次操作的成功回执，可使用原请求编号核对后重试")
    scope = operation.scope_json
    if not scope or scope.get("access") not in {"authoring", "admin"}:
        raise HTTPException(status_code=409, detail="此历史回执请通过对应课程记录查看")
    if scope["access"] == "admin":
        if actor.role != "admin":
            raise HTTPException(status_code=403, detail="学校审核回执需要管理权限")
    else:
        if actor.role != "teacher":
            raise HTTPException(status_code=403, detail="课程操作回执需要教师权限")
        school = require_school_teacher_or_admin(db, actor, scope["school_id"])
        if school.status != "active":
            raise HTTPException(status_code=403, detail="学校当前未开放")
        for course_id in scope["course_ids"]:
            authoring_course(db, actor, course_id)
    return {"client_request_id": operation.client_request_id, "operation_kind": operation.operation_kind, "response": deepcopy(operation.receipt_json)}


def draft_snapshot(db: Session, course: Course) -> dict:
    draft = content_platform._shared_draft_read(db, course)
    models = {unit.id: unit for unit in db.scalars(select(CourseUnit).where(CourseUnit.course_id == course.id)).all()}
    units = []
    for item in draft["units"]:
        unit = models[item["id"]]
        content = item["content"].model_dump(mode="json") if item["content"] is not None else None
        origins = dict(unit.block_origins_json or {})
        if content is not None:
            origins = {block["blockId"]: origins.get(block["blockId"], f"{unit.origin_key}:{block['blockId']}") for block in content["blocks"]}
        units.append({"id": unit.id, "activity_key": unit.activity_key, "origin_key": unit.origin_key, "block_origins": origins, "resource_version_id": unit.resource_version_id, "title": unit.title, "position": unit.position, "content": content})
    return {"settings": current_settings(db, course), "units": units}


def capture_revision(db: Session, course: Course, actor: User) -> CourseRevision:
    snapshot = draft_snapshot(db, course)
    existing = db.scalar(select(CourseRevision).where(CourseRevision.course_id == course.id, CourseRevision.revision_number == course.content_draft_revision))
    digest = canonical_sha256(snapshot)
    if existing is not None:
        if existing.content_sha256 != digest:
            raise HTTPException(status_code=409, detail="同一修订的内容已发生漂移，请重新保存草稿")
        return existing
    revision = CourseRevision(course_id=course.id, revision_number=course.content_draft_revision, snapshot_json=snapshot, content_sha256=digest, created_by_user_id=actor.id)
    db.add(revision)
    db.flush()
    return revision


def draft_response(db: Session, course: Course, *, warnings: list[str] | None = None) -> dict:
    snapshot = draft_snapshot(db, course)
    revision = db.scalar(select(CourseRevision).where(CourseRevision.course_id == course.id, CourseRevision.revision_number == course.content_draft_revision))
    legacy = content_platform._shared_draft_read(db, course)
    by_id = {item["id"]: item for item in legacy["units"]}
    version_ids = {block["resourceVersionId"] for unit in snapshot["units"] for block in (unit["content"] or {}).get("blocks", []) if block["type"] == "resource"}
    units = [{**by_id[unit["id"]], **unit} for unit in snapshot["units"]]
    return {"course_id": course.id, "family_id": course.family_id, "revision": course.content_draft_revision, "revision_id": revision.id if revision else None, "state_token": canonical_sha256(snapshot), "settings": snapshot["settings"], "units": units, "resources": [get_resource_version(db, version_id) for version_id in sorted(version_ids)], "warnings": warnings or []}


def course_response(db: Session, course: Course) -> dict:
    data = course_authoring.build_course_draft_read(db, course)
    settings = current_settings(db, course, data=data)
    return {**data, "family_id": course.family_id, "source_course_id": course.source_course_id, "source_release_id": course.source_release_id, "source_revision_id": course.source_revision_id, "workflow_generation": course.workflow_generation, "level_key": settings["level_key"], "draft_settings": settings}
