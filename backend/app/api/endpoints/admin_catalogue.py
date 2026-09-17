from fastapi import APIRouter, Depends

from app.api.deps.auth import get_current_user
from app.models import User
from app.services.admin_common import require_admin
from app.services.learning_resources import _builtin_descriptors, spaces_manifest


router = APIRouter()


@router.get("/catalogue/preview")
def preview_catalogue(current_user: User = Depends(get_current_user)) -> dict:
    require_admin(current_user)
    latest: dict[str, dict] = {}
    for descriptor in _builtin_descriptors():
        if descriptor.get("kind") != "activity":
            continue
        key = str(descriptor["key"])
        version = int(descriptor.get("version_number", 1))
        previous = latest.get(key)
        if previous is None or version > int(previous.get("version_number", 1)):
            latest[key] = descriptor
    items = []
    for index, descriptor in enumerate(sorted(latest.values(), key=lambda item: (item["space"], item["key"])), 1):
        items.append(
            {
                "id": index,
                "resource_key": descriptor["key"],
                "space_key": descriptor["space"],
                "subject_key": descriptor["subject"],
                "kind": "activity",
                "version_number": int(descriptor.get("version_number", 1)),
                "title": descriptor["title"],
                "renderer": descriptor["renderer"],
                "definition": descriptor["definition"],
                "capabilities": descriptor["capabilities"],
                "provenance": descriptor["provenance"],
                "content_sha256": "catalogue-preview",
            }
        )
    return {"spaces": spaces_manifest()["spaces"], "items": items, "total": len(items)}
