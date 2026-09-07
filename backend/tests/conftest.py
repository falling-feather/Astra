import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.db.session import reset_database_state
from app.main import create_app


@pytest.fixture()
def client(monkeypatch):
    # Existing low-level fixtures exercise legacy provisioning explicitly.
    # Public registration/organization authority has dedicated default-mode tests.
    monkeypatch.setenv("ASTRA_ALLOW_LEGACY_LOCAL_BOOTSTRAP", "true")
    monkeypatch.setenv("ASTRA_DATABASE_URL", "sqlite+pysqlite:///:memory:")
    monkeypatch.setenv("ASTRA_AUTO_CREATE_TABLES", "true")
    get_settings.cache_clear()
    reset_database_state()
    with TestClient(create_app()) as test_client:
        yield test_client
    get_settings.cache_clear()
    reset_database_state()

