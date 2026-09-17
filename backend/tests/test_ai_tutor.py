import json

import httpx
import pytest

from app.core.config import get_settings
from test_content_platform_api import _auth, _register


@pytest.fixture()
def tutor_actor(client, monkeypatch):
    monkeypatch.setenv("ASTRA_AI_TUTOR_ENABLED", "true")
    monkeypatch.setenv("ASTRA_AI_TUTOR_API_KEY", "local-test-secret")
    monkeypatch.setenv("ASTRA_AI_TUTOR_BASE_URL", "https://tutor.example.test/v1")
    monkeypatch.setenv("ASTRA_AI_TUTOR_MODEL", "test-tutor-model")
    monkeypatch.setenv("ASTRA_AI_TUTOR_TIMEOUT_SECONDS", "17")
    get_settings.cache_clear()
    return _auth(_register(client, "tutor_student", "student")["token"])


def _capture_upstream(monkeypatch, handler):
    client_type = httpx.Client
    requests = []

    def respond(request):
        requests.append(request)
        return handler(request)

    def create_client(*, timeout):
        assert timeout == 17
        return client_type(timeout=timeout, transport=httpx.MockTransport(respond))

    monkeypatch.setattr(httpx, "Client", create_client)
    return requests


def test_tutor_requires_login_before_config_or_upstream_chat(client, tutor_actor, monkeypatch):
    requests = _capture_upstream(monkeypatch, lambda request: httpx.Response(200, json={}))
    unauthenticated = {"Cookie": ""}
    assert client.get("/api/ai-tutor/config", headers=unauthenticated).status_code == 401
    assert client.post("/api/ai-tutor/chat", headers=unauthenticated, json={"message": "如何观察？"}).status_code == 401
    assert requests == []


@pytest.mark.parametrize("setting,value", [("ASTRA_AI_TUTOR_ENABLED", "false"), ("ASTRA_AI_TUTOR_API_KEY", "")])
def test_disabled_tutor_hides_model_and_does_not_call_upstream(client, tutor_actor, monkeypatch, setting, value):
    monkeypatch.setenv(setting, value)
    get_settings.cache_clear()
    requests = _capture_upstream(monkeypatch, lambda request: httpx.Response(200, json={}))
    response = client.get("/api/ai-tutor/config", headers=tutor_actor)
    assert response.status_code == 200
    assert response.json() == {"enabled": False, "provider": "deepseek", "model": None}
    response = client.post("/api/ai-tutor/chat", headers=tutor_actor, json={"message": "如何观察？"})
    assert response.status_code == 503
    assert response.json() == {"detail": "学校尚未启用 AI 助教"}
    assert requests == []


def test_tutor_sends_actor_context_and_returns_only_the_answer(client, tutor_actor, monkeypatch):
    requests = _capture_upstream(monkeypatch, lambda request: httpx.Response(200, json={
        "choices": [{"message": {"content": "  先比较两次摆动的周期。  "}}],
        "usage": {"total_tokens": 100},
    }))
    config = client.get("/api/ai-tutor/config", headers=tutor_actor)
    assert config.status_code == 200
    assert config.json() == {"enabled": True, "provider": "deepseek", "model": "test-tutor-model"}
    assert requests == []
    response = client.post("/api/ai-tutor/chat", headers=tutor_actor, json={
        "message": "  如何比较？  ",
        "context": {"space": "englab", "page_title": "摆的运动", "route": ""},
    })
    assert response.status_code == 200
    assert response.json() == {"answer": "先比较两次摆动的周期。", "provider": "deepseek", "model": "test-tutor-model"}
    assert "local-test-secret" not in config.text + response.text
    assert len(requests) == 1
    request = requests[0]
    assert str(request.url) == "https://tutor.example.test/v1/chat/completions"
    assert request.headers["Authorization"] == "Bearer local-test-secret"
    body = json.loads(request.content)
    assert body["model"] == "test-tutor-model"
    assert body["temperature"] == 0.35
    assert body["stream"] is False
    assert len(body["messages"]) == 2
    assert body["messages"][0]["role"] == "system"
    assert "当前学习身份：student" in body["messages"][0]["content"]
    assert "当前页面上下文：space=englab；page_title=摆的运动。" in body["messages"][0]["content"]
    assert body["messages"][1] == {"role": "user", "content": "如何比较？"}


@pytest.mark.parametrize("failure", ["timeout", "status", "json", "empty_answer"])
def test_tutor_upstream_failures_return_safe_gateway_errors(client, tutor_actor, monkeypatch, failure):
    def respond(request):
        if failure == "timeout":
            raise httpx.ReadTimeout("upstream secret must stay private", request=request)
        if failure == "status":
            return httpx.Response(429, json={"error": "upstream secret must stay private"})
        if failure == "json":
            return httpx.Response(200, text="upstream secret must stay private")
        return httpx.Response(200, json={"choices": [{"message": {"content": "  "}}]})

    requests = _capture_upstream(monkeypatch, respond)
    response = client.post("/api/ai-tutor/chat", headers=tutor_actor, json={"message": "如何观察？"})
    assert response.status_code == 502
    assert response.json() == {"detail": "模型没有返回可显示的回答" if failure == "empty_answer" else "AI 助教暂时无法连接模型服务"}
    assert len(requests) == 1
