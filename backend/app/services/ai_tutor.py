"""School-configured tutor availability and bounded upstream chat requests."""

from urllib.parse import urljoin

import httpx
from fastapi import HTTPException, status

from app.core.config import get_settings
from app.models import User
from app.schemas.ai_tutor import AiTutorChatCreate, AiTutorChatRead, AiTutorConfigRead


def _config() -> tuple[bool, str, str, str | None]:
    settings = get_settings()
    key = settings.ai_tutor_api_key.get_secret_value() if settings.ai_tutor_api_key else None
    enabled = bool(settings.ai_tutor_enabled and key and settings.ai_tutor_provider == "deepseek")
    return enabled, settings.ai_tutor_provider, settings.ai_tutor_model, key


def get_config() -> AiTutorConfigRead:
    enabled, provider, model, _ = _config()
    return AiTutorConfigRead(enabled=enabled, provider=provider, model=model if enabled else None)


def chat(payload: AiTutorChatCreate, *, actor: User) -> AiTutorChatRead:
    enabled, provider, model, api_key = _config()
    if not enabled or not api_key:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="学校尚未启用 AI 助教")
    context = payload.context or {}
    context_line = "；".join(f"{key}={value}" for key, value in context.items() if value)
    system = (
        "你是星序学习平台的 AI 助教。使用简洁、可验证的中文回答，优先引导学生观察、提出假设和检查证据，"
        "不要替代教师评分，不要声称学生已经掌握，也不要编造当前实验中不存在的参数。"
        f"当前学习身份：{actor.role}。当前页面上下文：{context_line or '未提供'}。"
    )
    endpoint = urljoin(get_settings().ai_tutor_base_url.rstrip("/") + "/", "chat/completions")
    request_body = {
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": payload.message}],
        "temperature": 0.35,
        "stream": False,
    }
    try:
        with httpx.Client(timeout=get_settings().ai_tutor_timeout_seconds) as client:
            response = client.post(endpoint, headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}, json=request_body)
            response.raise_for_status()
            data = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="AI 助教暂时无法连接模型服务") from exc
    choices = data.get("choices") if isinstance(data, dict) else None
    answer = choices[0].get("message", {}).get("content") if choices and isinstance(choices[0], dict) else None
    if not isinstance(answer, str) or not answer.strip():
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="模型没有返回可显示的回答")
    return AiTutorChatRead(answer=answer.strip(), provider=provider, model=model)
