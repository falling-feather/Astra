from fastapi import APIRouter, Depends

from app.api.deps.auth import get_current_user
from app.services import admin_catalogue as service


router = APIRouter()


@router.get("/catalogue/preview")
def preview_catalogue(actor=Depends(get_current_user)) -> dict:
    return service.preview_catalogue(actor=actor)
