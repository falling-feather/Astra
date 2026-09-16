"""Bind the existing runtime protocol to a server-issued learning context."""
import math
from copy import deepcopy
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.learning_evidence_contract import canonical_sha256
from app.models import ClassMembership, LearningActivityRuntime, LearningContext, LearningEvidenceEvent, LearningResult, User
from app.services.content_platform import _public_content_page
from app.services.learning_contexts import require_context
from app.services.learning_results import carry_late_result
from app.services.learning_resources import get_resource_version
from app.models.learning_evidence import CURRENT_EVENT_SCHEMA_VERSION

MANIFEST_VERSION = "astra-context-activity-v1"
STATE_SCHEMA = "astra-observation-state-v1"


def pinned_scope(db: Session, *, actor: User, context_key: str, coordinates=None, versions=None, write: bool = False) -> dict:
    context, scope = require_context(db, actor=actor, context_key=context_key, write=write)
    if context.mode != "formal" or scope is None:
        raise HTTPException(status_code=403, detail="探索与教师预览不能写入正式课程运行")
    if not any(block["type"] in {"resource", "official-simulation"} for block in scope["version"].schema_json["blocks"]):
        raise HTTPException(status_code=409, detail="这个学习单元没有已发布的交互资源")
    scope["learning_context"] = context
    scope["subject_user_id"] = actor.id
    # formal_scope already checked the original release's prerequisites and current access.
    from app.services.course_release_plans import get_plan_for_unit
    scope["plan"] = get_plan_for_unit(db, scope["course_class"], scope["unit"].id)
    if coordinates is not None:
        expected = (context.class_id, context.course_id, context.course_unit_id, scope["unit"].activity_key)
        actual = (coordinates.class_id, coordinates.course_id, coordinates.course_unit_id, coordinates.activity_key)
        if actual != expected:
            raise HTTPException(status_code=403, detail="实验运行与本次学习的课程、单元或教学范围不一致")
    if versions is not None:
        expected = (MANIFEST_VERSION, public_content_version(scope), scope["rule"].version_number, context.context_key)
        actual = (versions.manifest_version, versions.content_version, versions.rule_version, versions.generation)
        if actual != expected:
            raise HTTPException(status_code=409, detail="实验运行没有使用本次学习固定的内容与规则版本")
    return scope


def public_content_version(scope: dict) -> str:
    return canonical_sha256(_public_content_page(scope["version"].schema_json))


def runtime_config(db: Session, *, actor: User, context_key: str) -> dict:
    scope = pinned_scope(db, actor=actor, context_key=context_key)
    context = scope["learning_context"]
    return {
        "context_key": context.context_key,
        "scope": {"class_id": context.class_id, "course_id": context.course_id, "course_unit_id": context.course_unit_id, "activity_key": scope["unit"].activity_key},
        "subject_identity": {"kind": "learner", "id": str(actor.id)},
        "manifest_version": MANIFEST_VERSION,
        "content_version": public_content_version(scope),
        "event_schema_version": CURRENT_EVENT_SCHEMA_VERSION,
        "rule_version": scope["rule"].version_number,
        "generation": context.context_key,
        "state_schema_version": STATE_SCHEMA,
        "blocks": recordable_blocks(db, scope),
    }


def recordable_blocks(db: Session, scope: dict) -> list[dict]:
    result = []
    for block in scope["version"].schema_json["blocks"]:
        version_id = block.get("resourceVersionId") if block["type"] == "resource" else scope["learning_context"].resource_version_id if block["type"] == "official-simulation" else None
        if not version_id:
            continue
        version = get_resource_version(db, version_id)
        if block["type"] == "official-simulation" and version["resource_key"] != block["simulationKey"]:
            continue
        caps = version["capabilities"]
        if caps.get("operation_recording") is not True:
            continue
        adapter = caps.get("observation_adapter")
        if adapter == "function-parameters-v1":
            configuration = block.get("configuration") or version["definition"]["configuration"]
            controls = configuration.get("parameters", [])
        elif adapter == "numeric-controls-v1":
            controls = caps["controls"]
        else:
            continue
        result.append({"block_id": block["blockId"], "resource_version_id": version_id, "adapter": adapter, "entry": version["definition"].get("entry"), "controls": deepcopy(controls)})
    return result


def validate_observation(db: Session, scope: dict, payload) -> None:
    """This manifest records explicit parameter observations, never arbitrary completion claims."""
    command = payload.command
    blocks = recordable_blocks(db, scope)
    if not blocks:
        raise HTTPException(status_code=409, detail="该发布版没有声明可记录的操作，请使用课程检查点或教师评阅")
    if (command.event_type == "started") != (command.run.sequence == 1):
        raise HTTPException(status_code=422, detail="每次运行只能从一次明确的开始记录进入，随后追加实际参数操作")
    if command.event_type == "started":
        if payload.snapshot.data != {"last_observation": None}:
            raise HTTPException(status_code=422, detail="开始记录时不能夹带未发生的参数操作")
        return
    observation = command.evidence.get("cursor")
    if command.event_type != "attempted" or command.evidence.get("operation") != "parameter-change" or not isinstance(observation, dict) or set(observation) != {"block_id", "parameter", "value"}:
        raise HTTPException(status_code=422, detail="此运行协议只接受已声明参数的操作观察")
    control = next((control for block in blocks if block["block_id"] == observation["block_id"] for control in block["controls"] if control["key"] == observation["parameter"]), None)
    value = observation["value"]
    if control is None or isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not control["minimum"] <= value <= control["maximum"]:
        raise HTTPException(status_code=422, detail="参数不属于该发布版，或值超出了教师允许范围")
    if payload.snapshot.data != {"last_observation": observation}:
        raise HTTPException(status_code=422, detail="操作与状态快照不一致")


def assert_runtime_context(runtime: LearningActivityRuntime | None, scope: dict) -> None:
    expected = scope["learning_context"].id if scope.get("learning_context") else None
    if runtime is not None and runtime.learning_context_id != expected:
        raise HTTPException(status_code=409, detail="该运行已经属于另一次学习；请保留原学习入口，不能重新绑定")


def authority_revision(db: Session, actor: User, scope: dict) -> str:
    context: LearningContext = scope["learning_context"]
    membership = db.scalar(select(ClassMembership).where(ClassMembership.class_id == context.class_id, ClassMembership.user_id == actor.id, ClassMembership.role == "student", ClassMembership.status == "active"))
    if membership is None:
        raise HTTPException(status_code=403, detail="原学习权限已撤回")
    # Course/title timestamps change during publication; they are not authorization.
    return canonical_sha256({"context_id": context.id, "scope_sha256": context.scope_sha256, "user_id": actor.id, "role": actor.role, "status": actor.status, "membership_id": membership.id})


def release_revision(scope: dict) -> str:
    context, plan = scope["learning_context"], scope["plan"]
    return canonical_sha256({"context_id": context.id, "release_id": context.course_release_id, "scope_sha256": context.scope_sha256, "mode": plan.release_mode, "open_at": plan.open_at, "prerequisite_unit_id": plan.prerequisite_unit_id})


def record_runtime_results(db: Session, *, scope: dict, events: list[LearningEvidenceEvent]) -> None:
    context = scope["learning_context"]
    known = set(db.scalars(select(LearningResult.evidence_event_id).where(LearningResult.evidence_event_id.in_([event.id for event in events]))))
    for event in events:
        if event.id in known:
            continue
        completed = event.producer_type == "rule" and event.event_type in {"completed", "transferred"}
        result = LearningResult(student_id=context.user_id, school_id=context.school_id, class_id=context.class_id, course_id=context.course_id, course_unit_id=context.course_unit_id, course_release_id=context.course_release_id, context_id=context.id, evidence_event_id=event.id, completed=completed, provenance="rule-operation" if completed else "learner-observation", occurred_at=event.occurred_at)
        db.add(result)
        db.flush()
        carry_late_result(db, result)
