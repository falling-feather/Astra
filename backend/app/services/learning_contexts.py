"""Learning start pins an existing release; every read/write rechecks access."""
from copy import deepcopy

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.learning_evidence_contract import as_utc, canonical_sha256
from app.models import Assignment, ClassGroup, ClassMembership, ContentPageVersion, Course, CourseCandidate, CourseClass, CourseEnrollment, CourseRelease, CourseReleaseUnit, CourseUnit, CourseUnitClassPlan, LearningCompletionRule, LearningContext, LearningResource, LearningResourceVersion, School, User
from app.schemas.learning_history import LearningContextStart
from app.services.access_control import get_course, lock_course_for_write, lock_scope_eligible_user
from app.services.content_platform import _canonical_sha256, _internal_course_class, _public_content_page
from app.services.course_release_plans import effective_unit_access
from app.services.course_snapshots import latest_release
from app.services.learning_resources import get_resource_version
from app.services.assignment_policies import resolve_assignment_class_policy
from app.services.learning_results import pinned_completed_units


def formal_scope(db: Session, *, actor: User, course_id: int, unit_id: int, release_id: int, write: bool = False) -> dict:
    if actor.role != "student" or actor.status != "active":
        raise HTTPException(status_code=403, detail="正式学习记录仅由当前有效学生身份提交")
    course = lock_course_for_write(db, course_id) if write else get_course(db, course_id)
    if write:
        lock_scope_eligible_user(db, actor.id, "student", detail="学生身份已变化", status_code=403)
        db.execute(update(Course).where(Course.id == course.id).values(updated_at=Course.updated_at))
    school = db.get(School, course.school_id)
    if school is None or school.status != "active":
        raise HTTPException(status_code=403, detail="学校当前未开放")
    if course.status != "published":
        raise HTTPException(status_code=403, detail="课程当前未开放")
    enrolled = db.scalar(select(CourseEnrollment.id).where(CourseEnrollment.course_id == course_id, CourseEnrollment.student_id == actor.id, CourseEnrollment.status == "active"))
    if enrolled is None:
        raise HTTPException(status_code=403, detail="你已不在这门课程的有效学习范围内")
    course_class = _internal_course_class(db, course_id, locking_read=write)
    group = db.get(ClassGroup, course_class.class_id)
    member = db.scalar(select(ClassMembership.id).where(ClassMembership.class_id == group.id, ClassMembership.user_id == actor.id, ClassMembership.role == "student", ClassMembership.status == "active"))
    if member is None or course_class.status != "active" or group.status != "active" or group.school_id != course.school_id:
        raise HTTPException(status_code=403, detail="教学范围或成员身份已变化")
    release = db.get(CourseRelease, release_id)
    unit = db.get(CourseUnit, unit_id)
    if release is None or release.course_id != course_id or unit is None or unit.course_id != course_id:
        raise HTTPException(status_code=404, detail="课程发布或单元不存在")
    frozen = db.scalar(select(CourseReleaseUnit).where(CourseReleaseUnit.course_release_id == release_id, CourseReleaseUnit.source_course_unit_id == unit_id))
    if frozen is None:
        raise HTTPException(status_code=404, detail="该单元不属于所选发布版")
    plan = db.scalar(select(CourseUnitClassPlan).where(CourseUnitClassPlan.course_class_id == course_class.id, CourseUnitClassPlan.course_unit_id == unit_id))
    if plan is None:
        raise HTTPException(status_code=409, detail="单元开放计划不可用")
    completed = pinned_completed_units(db, release=release, student_id=actor.id, class_id=group.id) if plan.prerequisite_unit_id else None
    access = effective_unit_access(db, course=course, class_group=group, unit=unit, plan=plan, student_id=actor.id, content_is_published=True, completed_unit_ids=completed)
    if access.state != "open":
        raise HTTPException(status_code=403 if access.state == "hidden" else 409, detail="这个单元的学习权限或开放安排已变化")
    version = db.get(ContentPageVersion, frozen.content_page_version_id)
    rule = db.get(LearningCompletionRule, release.completion_rule_id) if release.completion_rule_id else None
    if version is None or rule is None or rule.course_id != course_id:
        raise HTTPException(status_code=409, detail="发布内容或完成规则不完整")
    if version.schema_hash != frozen.content_schema_sha256 or rule.definition_sha256 != release.completion_rule_sha256:
        raise HTTPException(status_code=409, detail="发布内容或规则的完整性校验未通过")
    return {"course": course, "unit": unit, "course_class": course_class, "class_group": group, "release": release, "release_unit": frozen, "version": version, "rule": rule}


def context_identity(scope: dict, resource_id: int | None, assignment: dict | None = None) -> dict:
    return {"course_id": scope["course"].id, "unit_id": scope["unit"].id, "class_id": scope["class_group"].id, "release_id": scope["release"].id, "content_sha256": scope["version"].schema_hash, "rule_sha256": scope["rule"].definition_sha256, "resource_version_id": resource_id, "assignment": assignment}


def assignment_access(db: Session, scope: dict, assignment_id: int, *, write: bool):
    assignment = db.get(Assignment, assignment_id)
    if assignment is None or assignment.unit_id != scope["unit"].id:
        raise HTTPException(status_code=404, detail="作业不属于当前学习单元")
    policy = resolve_assignment_class_policy(db, assignment, scope["class_group"].id, locking_read=write)
    if not policy.assigned:
        raise HTTPException(status_code=403, detail="这份作业已不在当前教学范围内")
    if write and policy.status != "active":
        raise HTTPException(status_code=409, detail="教师已关闭这份作业，当前不能提交")
    return assignment, policy


def frozen_assignment(db: Session, scope: dict, assignment_id: int) -> dict:
    # Opening a closed task is a read; submission independently checks its live policy.
    assignment, policy = assignment_access(db, scope, assignment_id, write=False)
    release = scope["release"]
    candidate = db.get(CourseCandidate, release.candidate_id) if release.candidate_id else None
    published = ((candidate.dependencies_json or {}).get("assignments") or {}).get(str(assignment.id)) if candidate else None
    definition = deepcopy(published) if published else {"id": assignment.id, "unit_id": assignment.unit_id, "title": assignment.title, "description": assignment.description, "max_score": assignment.max_score}
    return {**definition, "point_rule": deepcopy(policy.point_rule), "point_rule_source": policy.point_rule_source, "due_at": as_utc(policy.due_at).isoformat() if policy.due_at else None, "definition_origin": "course_release" if published else "task_at_learning_start"}


def start_context(db: Session, *, actor: User, payload: LearningContextStart, commit: bool = True) -> dict:
    command = payload.model_dump(mode="json")
    existing = db.scalar(select(LearningContext).where(LearningContext.user_id == actor.id, LearningContext.client_request_id == payload.client_request_id))
    if existing:
        if existing.request_sha256 != canonical_sha256(command):
            raise HTTPException(status_code=409, detail="这个请求编号已用于其他学习入口")
        return read_context(db, actor=actor, context_key=existing.context_key)
    if payload.mode == "formal":
        scope = formal_scope(db, actor=actor, course_id=payload.course_id, unit_id=payload.course_unit_id, release_id=payload.expected_release_id, write=True)
        current = latest_release(db, payload.course_id)
        if current is None or current.id != payload.expected_release_id:
            raise HTTPException(status_code=409, detail="课程已有新版本，请重新进入；已开始的学习可通过原记录继续")
        resource_ids = [block["resourceVersionId"] for block in scope["version"].schema_json["blocks"] if block["type"] == "resource"]
        official_keys = {block["simulationKey"] for block in scope["version"].schema_json["blocks"] if block["type"] == "official-simulation"}
        legacy_version = db.scalar(select(LearningResourceVersion).join(LearningResource, LearningResource.id == LearningResourceVersion.resource_id).where(LearningResource.resource_key.in_(official_keys)).order_by(LearningResourceVersion.version_number.desc(), LearningResourceVersion.id).limit(1)) if official_keys else None
        allowed_ids = set(resource_ids) | ({legacy_version.id} if legacy_version else set())
        resource_id = payload.resource_version_id or next(iter(resource_ids), legacy_version.id if legacy_version else None)
        if resource_id is not None and resource_id not in allowed_ids:
            raise HTTPException(status_code=422, detail="资源不属于该学习单元的发布版")
        assignment = frozen_assignment(db, scope, payload.assignment_id) if payload.assignment_id else None
        identity = context_identity(scope, resource_id, assignment)
        context = LearningContext(user_id=actor.id, mode="formal", school_id=scope["course"].school_id, course_id=scope["course"].id, course_unit_id=scope["unit"].id, class_id=scope["class_group"].id, course_release_id=scope["release"].id, resource_version_id=resource_id, assignment_id=payload.assignment_id, assignment_snapshot_json=assignment, client_request_id=payload.client_request_id, request_sha256=canonical_sha256(command), scope_sha256=canonical_sha256(identity))
    else:
        if actor.status != "active" or payload.mode == "preview" and actor.role not in {"teacher", "admin"}:
            raise HTTPException(status_code=403, detail="当前身份不能进入这个预览模式")
        resource = get_resource_version(db, payload.resource_version_id)
        context = LearningContext(user_id=actor.id, mode=payload.mode, resource_version_id=resource["id"], client_request_id=payload.client_request_id, request_sha256=canonical_sha256(command), scope_sha256=canonical_sha256({"resource_version_id": resource["id"], "content_sha256": resource["content_sha256"]}))
    db.add(context)
    db.flush()
    response = read_context(db, actor=actor, context_key=context.context_key)
    if commit:
        db.commit()
    return response


def require_context(db: Session, *, actor: User, context_key: str, write: bool = False) -> tuple[LearningContext, dict | None]:
    context = db.scalar(select(LearningContext).where(LearningContext.context_key == context_key, LearningContext.user_id == actor.id))
    if context is None:
        raise HTTPException(status_code=404, detail="学习记录不存在或不属于当前账号")
    if actor.status != "active":
        raise HTTPException(status_code=403, detail="账号已不可用")
    scope = None
    if context.mode == "formal":
        scope = formal_scope(db, actor=actor, course_id=context.course_id, unit_id=context.course_unit_id, release_id=context.course_release_id, write=write)
        if context.class_id != scope["class_group"].id or context.scope_sha256 != canonical_sha256(context_identity(scope, context.resource_version_id, context.assignment_snapshot_json)):
            raise HTTPException(status_code=409, detail="原学习身份与发布内容不再一致，请联系教师核对")
        if context.assignment_id:
            assignment_access(db, scope, context.assignment_id, write=write)
    elif context.mode == "preview" and actor.role not in {"teacher", "admin"}:
        raise HTTPException(status_code=403, detail="教师预览身份已变化")
    return context, scope


def read_context(db: Session, *, actor: User, context_key: str) -> dict:
    context, scope = require_context(db, actor=actor, context_key=context_key)
    content = _public_content_page(scope["version"].schema_json) if scope else None
    ids = {block["resourceVersionId"] for block in (content or {}).get("blocks", []) if block["type"] == "resource"}
    if context.resource_version_id:
        ids.add(context.resource_version_id)
    current = latest_release(db, context.course_id) if scope else None
    return {"context_key": context.context_key, "mode": context.mode, "user_id": actor.id, "course_id": context.course_id, "course_unit_id": context.course_unit_id, "class_id": context.class_id, "course_release_id": context.course_release_id, "release_number": scope["release"].release_number if scope else None, "release_unit_id": scope["release_unit"].id if scope else None, "published_at": as_utc(scope["release"].published_at) if scope else None, "activity_key": scope["unit"].activity_key if scope else None, "content_schema_sha256": _canonical_sha256(content) if content else None, "resource_version_id": context.resource_version_id, "assignment_id": context.assignment_id, "assignment": deepcopy(context.assignment_snapshot_json), "created_at": as_utc(context.created_at), "course_title": scope["release"].title_snapshot if scope else None, "unit_title": scope["release_unit"].title_snapshot if scope else None, "content": deepcopy(content), "resources": [get_resource_version(db, key) for key in sorted(ids)], "newer_release_available": bool(current and current.id != context.course_release_id), "records_course_results": context.mode == "formal"}
