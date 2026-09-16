"""Hashes bind the reviewed revision, external dependencies and result decisions."""
from copy import deepcopy
from app.core.learning_evidence_contract import canonical_sha256


def candidate_fingerprint(*, course_id: int, revision_id: int, revision_sha256: str, base_release_id: int | None, policies: dict, impact: dict, dependencies: dict) -> str:
    return canonical_sha256({"schema": "astra-reviewed-course-v1", "course_id": course_id, "revision_id": revision_id, "revision_sha256": revision_sha256, "base_release_id": base_release_id, "result_policies": policies, "impact": impact, "dependencies": dependencies})


def comparable_page(page: dict) -> dict:
    value = deepcopy(page)
    value.pop("version", None)
    value.pop("status", None)
    return value
