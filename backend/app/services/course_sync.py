"""Pure three-way comparison over server-owned unit and block provenance."""
from copy import deepcopy
import json
from pathlib import Path

from app.core.learning_evidence_contract import canonical_sha256

# Dependent fields form one decision (e.g. a question and its answer cannot be
# merged independently). Local block/checkpoint identities are never copied.
_GROUPS = json.loads((Path(__file__).resolve().parents[1] / "catalogue" / "course-sync-fields.v1.json").read_text(encoding="utf-8"))["groups"]


def _blocks(unit: dict) -> dict:
    return {unit["block_origins"][block["blockId"]]: block for block in (unit.get("content") or {}).get("blocks", [])}


def _values(block: dict, fields: tuple) -> dict:
    return {key: block[key] for key in fields if key in block}


def compare_sync(before: dict, after: dict, target: dict, target_id: int) -> list[dict]:
    old_units = {unit["origin_key"]: unit for unit in before["units"]}
    target_units = {unit["origin_key"]: unit for unit in target["units"]}
    changes = []
    for old_unit in before["units"]:
        if not any(unit["origin_key"] == old_unit["origin_key"] for unit in after["units"]):
            changes.append({"key": f"{target_id}:{old_unit['origin_key']}:removed", "status": "skipped", "unit_title": old_unit["title"], "reason": "移除章节不自动传播"})
    for source_unit in after["units"]:
        old_unit = old_units.get(source_unit["origin_key"])
        target_unit = target_units.get(source_unit["origin_key"])
        if old_unit is None:
            changes.append({"key": f"{target_id}:{source_unit['origin_key']}:new", "status": "skipped", "unit_title": source_unit["title"], "reason": "新增章节不自动同步"})
            continue
        old_blocks, new_blocks = _blocks(old_unit), _blocks(source_unit)
        target_blocks = _blocks(target_unit) if target_unit else {}
        for origin in old_blocks.keys() - new_blocks.keys():
            changes.append({"key": f"{target_id}:{origin}:removed", "status": "skipped", "unit_title": source_unit["title"], "reason": "移除内容块不自动传播"})
        for origin, new in new_blocks.items():
            old, current = old_blocks.get(origin), target_blocks.get(origin)
            if old is None or old["type"] != new["type"]:
                changes.append({"key": f"{target_id}:{origin}:structure", "status": "skipped", "unit_title": source_unit["title"], "reason": "新增或替换类型的内容不自动插入"})
                continue
            for fields in _GROUPS.get(new["type"], []):
                previous, next_value = _values(old, fields), _values(new, fields)
                if previous == next_value:
                    continue
                key = canonical_sha256({"course": target_id, "origin": origin, "fields": fields})
                item = {"key": key, "unit_title": source_unit["title"], "block_origin": origin, "fields": list(fields), "before": previous, "after": next_value}
                if current is None or current["type"] != new["type"]:
                    item.update(status="skipped", reason="无对应内容，跳过")
                else:
                    value = _values(current, fields)
                    item.update(unit_id=target_unit["id"], block_id=current["blockId"], current=value, status="unchanged" if value == next_value else "ready" if value == previous else "conflict")
                changes.append(item)
    return changes


def apply_sync(snapshot: dict, changes: list[dict], choices: dict[str, str]) -> tuple[dict, list[str]]:
    result = deepcopy(snapshot)
    units = {unit["id"]: unit for unit in result["units"]}
    applied = []
    for item in changes:
        if item["status"] != "ready" and not (item["status"] == "conflict" and choices.get(item["key"]) == "replace"):
            continue
        unit = units[item["unit_id"]]
        block = next(block for block in unit["content"]["blocks"] if block["blockId"] == item["block_id"])
        old_primary = block.get("resourceVersionId")
        for key in item["fields"]:
            if key in item["after"]:
                block[key] = deepcopy(item["after"][key])
            else:
                block.pop(key, None)
        if old_primary is not None and unit["resource_version_id"] == old_primary:
            unit["resource_version_id"] = block["resourceVersionId"]
        applied.append(item["key"])
    return result, applied
