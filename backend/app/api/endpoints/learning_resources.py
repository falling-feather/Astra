"""Read and configure registered resources without granting access to course bodies."""

from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user
from app.db.session import get_db
from app.schemas.learning_resources import LearningSpacesRead, ResourceInstallationRead, ResourcePage, ResourcePreview, ResourcePreviewRead, ResourceVersionRead
from app.services import learning_resources as service

router = APIRouter()


@router.get("/spaces", response_model=LearningSpacesRead)
def spaces(_actor=Depends(get_current_user)):
    return service.spaces_manifest()


@router.post("/resources/install-system", response_model=ResourceInstallationRead)
def install_resources(request: Request, actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service.install_system_resources(db, actor=actor, request=request)


@router.get("/resources", response_model=ResourcePage)
def resource_catalogue(space: str | None = Query(default=None, max_length=32), kind: Literal["activity", "template", "media"] | None = None, limit: int = Query(default=50, ge=1, le=100), offset: int = Query(default=0, ge=0), _actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service.list_resources(db, space=space, kind=kind, limit=limit, offset=offset)


@router.get("/resources/versions/{version_id}", response_model=ResourceVersionRead)
def resource_version(version_id: int, _actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service.get_resource_version(db, version_id)


@router.post("/resources/versions/{version_id}/preview", response_model=ResourcePreviewRead)
def preview_resource(version_id: int, payload: ResourcePreview, _actor=Depends(get_current_user), db: Session = Depends(get_db)):
    return service.preview_configuration(service.get_resource_version(db, version_id), payload.configuration.model_dump(mode="json"))
