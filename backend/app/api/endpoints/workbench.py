from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user
from app.db.session import get_db
from app.schemas.workbench import WorkbenchDTO
from app.services.workbench import build_workbench

router = APIRouter()


@router.get("/workbench", response_model=WorkbenchDTO)
def read_current_workbench(
    current_user: Annotated[Any, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    limit: int = Query(default=6, ge=1, le=20),
    offset: int = Query(default=0, ge=0),
) -> WorkbenchDTO:
    return build_workbench(
        db,
        actor=current_user,
        limit=limit,
        offset=offset,
    )
