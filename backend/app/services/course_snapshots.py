"""Version-aware snapshots and review impact, independent of mutable draft layout."""
from __future__ import annotations

from copy import deepcopy

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.course_workflow_contract import comparable_page
from app.core.learning_evidence_contract import canonical_sha256
from app.models import Assignment, Course, CourseAdmissionClass, CourseCandidate, CourseCollaborator, CourseRelease, CourseRevision, CourseUnit
from app.services import content_platform
from app.services.learning_resources import get_resource_version, validate_configuration
from app.services.course_media import reference_media, media_snapshot


def latest_release(db: Session, course_id: int) -> CourseRelease | None:
    return db.scalar(select(CourseRelease).where(CourseRelease.course_id == course_id).order_by(CourseRelease.release_number.desc()).limit(1))


def release_snapshot(db: Session, course: Course, release: CourseRelease) -> tuple[dict, dict]:
    if release.course_id != course.id:
        raise HTTPException(status_code=404, detail="发布不属于当前课程")
    if release.candidate_id is not None:
        candidate = db.get(CourseCandidate, release.candidate_id)
        revision = db.get(CourseRevision, candidate.revision_id) if candidate else None
        if candidate is None or revision is None or candidate.course_id != course.id or revision.course_id != course.id:
            raise HTTPException(status_code=409, detail="发布来源关系不完整")
        return deepcopy(revision.snapshot_json), deepcopy(candidate.dependencies_json or {})
    # Older packages did not freeze all course settings. Unknown fields stay absent.
    published = content_platform._course_release_read(db, release, include_answers=True)
    models = {unit.id: unit for unit in db.scalars(select(CourseUnit).where(CourseUnit.course_id == course.id)).all()}
    units = []
    for item in published["units"]:
        unit = models[item["source_course_unit_id"]]
        content = item["content"]
        units.append({"id": unit.id, "activity_key": item["activity_key"], "origin_key": unit.origin_key, "block_origins": {block["blockId"]: (unit.block_origins_json or {}).get(block["blockId"], f"{unit.origin_key}:{block['blockId']}") for block in content["blocks"]}, "resource_version_id": next((block["resourceVersionId"] for block in content["blocks"] if block["type"] == "resource"), None), "title": item["title"], "position": item["position"], "content": content})
    return {"settings": {"title": release.title_snapshot, "summary": release.summary_snapshot}, "units": units}, {}


def publication_baseline(db: Session, course: Course) -> tuple[CourseRelease | None, dict, dict]:
    release = latest_release(db, course.id)
    if release is None:
        return None, {"settings": {}, "units": []}, {}
    snapshot, dependencies = release_snapshot(db, course, release)
    return release, snapshot, dependencies


def freeze_dependencies(db: Session, course: Course, snapshot: dict) -> dict:
    resources: dict[str, dict] = {}
    assignments: dict[str, dict] = {}
    media: dict[str, dict] = {}
    for unit in snapshot["units"]:
        content = unit["content"]
        if not content:
            raise HTTPException(status_code=422, detail=f"{unit['title']} 尚未编排内容")
        completion = (content.get("courseUnit") or {}).get("completion")
        if not completion:
            raise HTTPException(status_code=422, detail=f"请为 {unit['title']} 选择完成条件")
        for block in content["blocks"]:
            if block["type"] == "resource":
                key = str(block["resourceVersionId"])
                if key not in resources:
                    resources[key] = get_resource_version(db, block["resourceVersionId"])
                resource = resources[key]
                validate_configuration(resource, block["configuration"])
                if completion["preset"] == "experiment_operation" and not resource["capabilities"].get("operation_recording"):
                    raise HTTPException(status_code=422, detail=f"{unit['title']} 的资源没有操作记录能力，请使用检查点或作业评阅")
            elif block["type"] == "media":
                media[block["assetKey"]] = media_snapshot(reference_media(db, course, block["assetKey"], block["mediaType"]))
        if completion["preset"] in {"assignment_reviewed", "assignment_accepted"}:
            assignment = db.get(Assignment, completion["assignmentId"])
            if assignment is None or assignment.unit_id != unit["id"] or assignment.status != "active":
                raise HTTPException(status_code=422, detail=f"{unit['title']} 的完成作业不存在或不属于当前单元")
            assignments[str(assignment.id)] = {"id": assignment.id, "unit_id": assignment.unit_id, "title": assignment.title, "description": assignment.description, "max_score": assignment.max_score, "point_rule": deepcopy(assignment.point_rule_json)}
    collaborators = [{"user_id": row.user_id, "role": row.role} for row in db.scalars(select(CourseCollaborator).where(CourseCollaborator.course_id == course.id, CourseCollaborator.status == "active").order_by(CourseCollaborator.user_id))]
    admission_classes = list(db.scalars(select(CourseAdmissionClass.class_id).where(CourseAdmissionClass.course_id == course.id, CourseAdmissionClass.status == "active").order_by(CourseAdmissionClass.class_id)))
    return {"resources": resources, "assignments": assignments, "media": media, "governance": {"creator_user_id": course.creator_user_id, "collaborators": collaborators, "admission_class_ids": admission_classes}}


def learning_signature(unit: dict, dependencies: dict) -> str:
    page = unit.get("content") or {}
    completion = (page.get("courseUnit") or {}).get("completion")
    blocks = []
    for block in page.get("blocks", []):
        if block["type"] == "checkpoint":
            blocks.append({key: value for key, value in block.items() if key not in {"blockId", "title"}})
        elif block["type"] == "resource":
            blocks.append({"type": "resource", "version": block["resourceVersionId"], "configuration": block["configuration"], "instructions": block["instructions"]})
        elif block["type"] == "official-simulation":
            blocks.append({"type": "official-simulation", "key": block["simulationKey"], "instructions": block["instructions"]})
    assignment = (dependencies.get("assignments") or {}).get(str((completion or {}).get("assignmentId")))
    return canonical_sha256({"completion": completion, "interactive_blocks": blocks, "assignment": assignment})


def review_impact(snapshot: dict, baseline: dict, dependencies: dict, baseline_dependencies: dict) -> dict:
    previous = {unit["origin_key"]: unit for unit in baseline["units"]}
    current = {unit["origin_key"]: unit for unit in snapshot["units"]}
    units = []
    for unit in snapshot["units"]:
        old = previous.get(unit["origin_key"])
        meaningful = old is not None and learning_signature(unit, dependencies) != learning_signature(old, baseline_dependencies)
        content_changed = old is None or comparable_page(unit["content"] or {}) != comparable_page(old["content"] or {}) or unit["title"] != old["title"] or unit["position"] != old["position"]
        units.append({"unit_id": unit["id"], "origin_key": unit["origin_key"], "title": unit["title"], "change": "added" if old is None else "modified" if content_changed or meaningful else "unchanged", "learning_changed": meaningful, "decision_required": meaningful, "default_policy": "redo" if old is None else None if meaningful else "keep"})
    old_settings = baseline["settings"]
    settings = [{"field": key, "before_recorded": key in old_settings, "before": old_settings.get(key), "after": value} for key, value in snapshot["settings"].items() if key not in old_settings or old_settings[key] != value]
    authority = dependencies.get("governance") or {}
    proposed = [{"user_id": key, "role": "editor"} for key in sorted(snapshot["settings"].get("collaborator_user_ids", []))]
    if authority.get("collaborators", []) != proposed:
        settings.append({"field": "collaborator_authority", "before_recorded": True, "before": authority.get("collaborators", []), "after": proposed})
    proposed_classes = sorted(snapshot["settings"].get("admission_class_ids", []))
    if authority.get("admission_class_ids", []) != proposed_classes:
        settings.append({"field": "current_admission_authority", "before_recorded": True, "before": authority.get("admission_class_ids", []), "after": proposed_classes})
    return {"settings": settings, "units": units, "removed_units": [{"unit_id": unit["id"], "title": unit["title"]} for key, unit in previous.items() if key not in current]}


def resolve_result_policies(impact: dict, choices: dict[str, str]) -> dict:
    allowed = {str(unit["unit_id"]) for unit in impact["units"]}
    if set(choices) - allowed:
        raise HTTPException(status_code=422, detail="结果策略包含不属于该候选的单元")
    policies = {}
    for unit in impact["units"]:
        key = str(unit["unit_id"])
        choice = choices.get(key, unit["default_policy"])
        if choice not in {"keep", "redo"}:
            raise HTTPException(status_code=422, detail=f"请明确 {unit['title']} 沿用结果还是要求补做")
        if unit["change"] == "unchanged" and choice != "keep":
            raise HTTPException(status_code=422, detail=f"{unit['title']} 未发生变化，应保留原结果")
        policies[key] = choice
    return policies
