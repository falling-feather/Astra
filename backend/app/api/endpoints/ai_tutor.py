from fastapi import APIRouter, Depends

from app.api.deps.auth import get_current_user
from app.schemas.ai_tutor import AiTutorChatCreate, AiTutorChatRead, AiTutorConfigRead
from app.services import ai_tutor as service


router = APIRouter()


@router.get("/config", response_model=AiTutorConfigRead)
def get_config(_actor=Depends(get_current_user)) -> AiTutorConfigRead:
    return service.get_config()


@router.post("/chat", response_model=AiTutorChatRead)
def chat(payload: AiTutorChatCreate, actor=Depends(get_current_user)) -> AiTutorChatRead:
    return service.chat(payload, actor=actor)
