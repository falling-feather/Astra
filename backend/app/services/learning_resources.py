"""System catalogue, immutable resource installation and bounded template previews."""

from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import re
from urllib.parse import unquote

from fastapi import HTTPException, Request
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import LearningResource, LearningResourceVersion, User
from app.core.learning_evidence_contract import canonical_sha256 as canonical_digest
from app.services.audit import record_audit_log
from app.schemas.learning_resources import DataChartConfig, FunctionGraphConfig
from app.schemas.official_activity_keys import OFFICIAL_ACTIVITY_KEYS
from app.services.template_expression import compile_expression, evaluate_expression

CATALOGUE_ROOT = Path(__file__).resolve().parents[1] / "catalogue"


def spaces_manifest() -> dict:
    manifest = json.loads((CATALOGUE_ROOT / "learning-spaces.v1.json").read_text(encoding="utf-8"))
    if manifest["schema_version"] != "astra-learning-spaces-v1":
        raise RuntimeError("Unsupported learning-space manifest")
    keys, views = set(), set()
    for space in manifest["spaces"]:
        key, view, entry = space["key"], space["view"], space["entry"]
        if not re.fullmatch(r"[a-z][a-z0-9-]{0,31}", key) or key in keys or view in views:
            raise RuntimeError("Learning spaces require unique stable identities")
        if view not in {"lab", "code", "future"} and view != f"space:{key}":
            raise RuntimeError("Invalid learning-space view")
        if space["kind"] not in {"legacy", "bundle"} or not space["title"] or not re.fullmatch(r"#[a-fA-F0-9]{6}", space["accent"]):
            raise RuntimeError("Invalid learning-space metadata")
        if not entry.startswith("labs/") or _unsafe_entry(entry):
            raise RuntimeError("Learning-space entry escaped the public bundle")
        if space["kind"] == "bundle" and entry.split("#")[0] != f"labs/spaces/{key}/index.html":
            raise RuntimeError("Imported bundle requires its own isolated directory")
        keys.add(key)
        views.add(view)
    return manifest


def _unsafe_entry(entry: str) -> bool:
    pathname = unquote(re.split(r"[?#]", entry, maxsplit=1)[0])
    return bool(re.match(r"^[a-z]+:|^/", entry, re.IGNORECASE) or re.search(r"[\\\s]", entry) or ".." in pathname.split("/") or "\\" in pathname)


def _bundle_descriptors(capabilities: dict) -> list[dict]:
    root = CATALOGUE_ROOT.parents[2]
    result = []
    for space in spaces_manifest()["spaces"]:
        if space["kind"] != "bundle":
            continue
        directory = root / "extensions" / space["key"] / "public"
        filename = directory / "astra-activities.json"
        if not filename.resolve().is_relative_to(root.resolve()) or filename.is_symlink():
            raise RuntimeError("Imported resource registration escaped the project")
        catalogue = json.loads(filename.read_text(encoding="utf-8"))
        if catalogue.get("schema_version") != "astra-activities-v1" or not isinstance(catalogue.get("activities"), list):
            raise RuntimeError("Invalid imported activity catalogue")
        for activity in catalogue["activities"]:
            entry = activity.get("entry", "index.html")
            if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{0,119}", activity["key"]) or not activity["title"] or not activity["subject"] or _unsafe_entry(entry):
                raise RuntimeError("Invalid imported activity identity or entry")
            page = directory / unquote(re.split(r"[?#]", entry, maxsplit=1)[0])
            if not page.is_file() or page.is_symlink() or not page.resolve().is_relative_to(directory.resolve()):
                raise RuntimeError("Imported activity entry is missing or escapes its bundle")
            result.append({"key": activity["key"], "space": space["key"], "subject": activity["subject"], "kind": "activity", "title": activity["title"], "renderer": "bundle", "definition": {"entry": f"labs/spaces/{space['key']}/{entry}", "configuration": {}}, "capabilities": {**capabilities, "runtime_pin": "legacy-compatibility"}, "provenance": {"kind": "registered-bundle", "space": space["key"]}})
    return result


def _builtin_descriptors() -> list[dict]:
    snapshot = json.loads((CATALOGUE_ROOT / "system-resources.v1.json").read_text(encoding="utf-8"))
    items = snapshot["resources"]
    if len(items) != len(OFFICIAL_ACTIVITY_KEYS) or {item["key"] for item in items} != OFFICIAL_ACTIVITY_KEYS:
        raise RuntimeError("System resource snapshot differs from the registered legacy identities")
    capabilities = {"operation_recording": False, "completion_modes": ["checkpoint_passed", "assignment_reviewed"]}
    descriptors = [{
        "key": item["key"], "space": item["space"], "subject": item["subject"], "kind": "activity",
        "title": item["title"], "renderer": "legacy", "definition": {"entry": item["entry"], "configuration": {}},
        "capabilities": {**capabilities, "runtime_pin": "legacy-compatibility"},
        "provenance": {"kind": "system-preset", "source_revision": snapshot["source_revision"], "activity_key": item["key"]},
    } for item in items]
    descriptors.extend(json.loads((CATALOGUE_ROOT / "templates.v1.json").read_text(encoding="utf-8"))["templates"])
    descriptors.extend(_bundle_descriptors(capabilities))
    if len({item["key"] for item in descriptors}) != len(descriptors):
        raise RuntimeError("Resource identities collide across registered spaces")
    return descriptors


def install_system_resources(db: Session, *, actor: User, request: Request | None = None) -> dict:
    if actor.role != "admin" or actor.status != "active":
        raise HTTPException(status_code=403, detail="系统资源由学校管理员载入，教师只能配置自己的教学内容")
    descriptors = _builtin_descriptors()
    try:
        existing = {resource.resource_key: resource for resource in db.scalars(select(LearningResource)).all()}
        for descriptor in descriptors:
            resource = existing.get(descriptor["key"])
            if resource is None:
                resource = LearningResource(resource_key=descriptor["key"], space_key=descriptor["space"], subject_key=descriptor["subject"], kind=descriptor["kind"])
                db.add(resource)
                existing[descriptor["key"]] = resource
            elif (resource.space_key, resource.subject_key, resource.kind) != (descriptor["space"], descriptor["subject"], descriptor["kind"]):
                raise HTTPException(status_code=409, detail="系统资源身份与已有记录不一致，不能覆盖")
        db.flush()
        stored = {version.resource_id: version for version in db.scalars(select(LearningResourceVersion).where(LearningResourceVersion.version_number == 1)).all()}
        installed = 0
        for descriptor in descriptors:
            resource = existing[descriptor["key"]]
            digest = canonical_digest(descriptor)
            if resource.id in stored:
                if stored[resource.id].content_sha256 != digest:
                    raise HTTPException(status_code=409, detail="系统资源 v1 已存在且内容不同，须新增版本")
                continue
            db.add(LearningResourceVersion(resource_id=resource.id, version_number=1, title=descriptor["title"], renderer=descriptor["renderer"], definition_json=descriptor["definition"], capabilities_json=descriptor["capabilities"], provenance_json=descriptor["provenance"], content_sha256=digest))
            installed += 1
        if installed:
            record_audit_log(db, actor=actor, action="resource.catalogue.install", resource_type="system-resource", resource_id="builtin", request=request, event_result="success", snapshot={"installed_versions": installed, "catalogue_size": len(descriptors)})
        db.commit()
        return {"installed_versions": installed, "catalogue_size": len(descriptors)}
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="另一项初始化已写入资源，请重新读取目录后再操作") from exc
    except Exception:
        db.rollback()
        raise


def _version_view(resource: LearningResource, version: LearningResourceVersion) -> dict:
    return {
        "id": version.id, "resource_key": resource.resource_key, "space_key": resource.space_key,
        "subject_key": resource.subject_key, "kind": resource.kind, "version_number": version.version_number,
        "title": version.title, "renderer": version.renderer, "definition": deepcopy(version.definition_json),
        "capabilities": deepcopy(version.capabilities_json), "provenance": deepcopy(version.provenance_json),
        "content_sha256": version.content_sha256,
    }


def list_resources(db: Session, *, space: str | None = None, kind: str | None = None, limit: int = 50, offset: int = 0) -> dict:
    latest = select(LearningResourceVersion.resource_id, func.max(LearningResourceVersion.version_number).label("number")).group_by(LearningResourceVersion.resource_id).subquery()
    query = select(LearningResource, LearningResourceVersion).join(latest, latest.c.resource_id == LearningResource.id).join(LearningResourceVersion, (LearningResourceVersion.resource_id == LearningResource.id) & (LearningResourceVersion.version_number == latest.c.number)).where(LearningResource.status == "active")
    if space is not None:
        query = query.where(LearningResource.space_key == space)
    if kind is not None:
        query = query.where(LearningResource.kind == kind)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.execute(query.order_by(LearningResource.kind.desc(), LearningResource.resource_key).offset(offset).limit(limit)).all()
    return {"items": [_version_view(resource, version) for resource, version in rows], "total": total, "limit": limit, "offset": offset, "next_offset": offset + len(rows) if offset + len(rows) < total else None}


def get_resource_version(db: Session, version_id: int) -> dict:
    pair = db.execute(select(LearningResource, LearningResourceVersion).join(LearningResourceVersion, LearningResourceVersion.resource_id == LearningResource.id).where(LearningResourceVersion.id == version_id, LearningResource.status == "active")).one_or_none()
    if pair is None:
        raise HTTPException(status_code=404, detail="资源版本不存在或已停止开放")
    return _version_view(*pair)


def preview_configuration(version: dict, configuration: dict) -> dict:
    renderer = version["renderer"]
    try:
        if renderer == "function-graph-v1":
            config = FunctionGraphConfig.model_validate(configuration)
            ast = compile_expression(config.formula, {"x", *(parameter.key for parameter in config.parameters)})
            variables = {parameter.key: parameter.value for parameter in config.parameters}
            points = []
            for index in range(config.samples):
                x = config.x_min + (config.x_max - config.x_min) * index / (config.samples - 1)
                points.append({"x": x, "y": evaluate_expression(ast, {**variables, "x": x})})
            normalized, view = config.model_dump(mode="json"), {"ast": ast, "points": points, "undefined_count": sum(point["y"] is None for point in points)}
        elif renderer == "data-chart-v1":
            config = DataChartConfig.model_validate(configuration)
            normalized, view = config.model_dump(mode="json"), {"minimum": min(0, *(value for series in config.series for value in series.values)), "maximum": max(0, *(value for series in config.series for value in series.values))}
        elif renderer in {"legacy", "bundle"}:
            if configuration:
                raise ValueError("该预置实验尚未声明可配置字段")
            normalized, view = {}, {"entry": version["definition"]["entry"], "runtime_pin": "legacy-compatibility"}
        else:
            raise ValueError("当前客户端不支持这个资源运行版本")
    except (ValueError, ValidationError) as exc:
        raise HTTPException(status_code=422, detail={"code": "resource_configuration_invalid", "message": str(exc)}) from exc
    return {"resource_version_id": version["id"], "renderer": renderer, "configuration": normalized, "view": view}
