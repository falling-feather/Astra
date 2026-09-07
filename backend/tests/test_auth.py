from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings
from app.core.security import hash_password, hash_token
from app.db.session import get_session_factory
from app.models import AuditLog, AuthSession, LoginAttempt, PasswordResetToken, User


def _auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Cookie": ""}


def test_register_login_me_logout(client):
    register = client.post(
        "/api/auth/register",
        json={
            "username": "teacher01",
            "password": "secret123",
            "display_name": "Teacher One",
            "role": "teacher",
        },
    )
    assert register.status_code == 201
    assert register.json()["role"] == "teacher"

    login = client.post(
        "/api/auth/login",
        json={"username": "teacher01", "password": "secret123"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]

    me = client.get("/api/users/me", headers=_auth_header(token))
    assert me.status_code == 200
    assert me.json()["username"] == "teacher01"

    logout = client.post("/api/auth/logout", headers=_auth_header(token))
    assert logout.status_code == 200

    after_logout = client.get("/api/users/me", headers=_auth_header(token))
    assert after_logout.status_code == 401


def test_login_openapi_marks_token_as_non_browser_compatibility_only(client):
    schema = client.get("/api/openapi.json").json()["components"]["schemas"]["LoginResponse"]
    token_schema = schema["properties"]["access_token"]

    assert "non-browser API clients" in token_schema["description"]
    assert "Browser clients must ignore" in token_schema["description"]


def test_cookie_only_session_lifecycle(client):
    register = client.post(
        "/api/auth/register",
        json={
            "username": "cookie_session_owner",
            "password": "secret123",
            "display_name": "Cookie Session Owner",
            "role": "student",
        },
    )
    assert register.status_code == 201

    login = client.post(
        "/api/auth/login",
        json={"username": "cookie_session_owner", "password": "secret123"},
    )
    assert login.status_code == 200

    me = client.get("/api/users/me")
    assert me.status_code == 200
    assert me.json()["username"] == "cookie_session_owner"

    logout = client.post("/api/auth/logout")
    assert logout.status_code == 200
    assert client.get("/api/users/me").status_code == 401


def test_mixed_cookie_and_bearer_credentials_fail_closed(client):
    register = client.post(
        "/api/auth/register",
        json={
            "username": "mixed_credential_owner",
            "password": "secret123",
            "display_name": "Mixed Credential Owner",
            "role": "teacher",
        },
    )
    assert register.status_code == 201
    login = client.post(
        "/api/auth/login",
        json={"username": "mixed_credential_owner", "password": "secret123"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]

    response = client.get(
        "/api/users/me",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "Multiple authentication credentials"}
    assert token not in response.text

    client.cookies.clear()
    empty_cookie_response = client.get(
        "/api/users/me",
        headers={
            "Authorization": f"Bearer {token}",
            "Cookie": f"{get_settings().session_cookie_name}=",
        },
    )
    assert empty_cookie_response.status_code == 400
    assert empty_cookie_response.json() == {"detail": "Multiple authentication credentials"}
    assert token not in empty_cookie_response.text


def test_repeated_authorization_headers_fail_closed(client):
    register = client.post(
        "/api/auth/register",
        json={
            "username": "repeated_authorization_owner",
            "password": "secret123",
            "display_name": "Repeated Authorization Owner",
            "role": "teacher",
        },
    )
    assert register.status_code == 201
    login = client.post(
        "/api/auth/login",
        json={"username": "repeated_authorization_owner", "password": "secret123"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    client.cookies.clear()

    response = client.get(
        "/api/users/me",
        headers=[
            ("Authorization", f"Bearer {token}"),
            ("Authorization", f"Bearer {token}"),
        ],
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "Multiple authentication credentials"}
    assert token not in response.text


@pytest.mark.parametrize("split_headers", [False, True])
def test_repeated_session_cookies_fail_closed(client, split_headers):
    register = client.post(
        "/api/auth/register",
        json={
            "username": "repeated_cookie_owner",
            "password": "secret123",
            "display_name": "Repeated Cookie Owner",
            "role": "student",
        },
    )
    assert register.status_code == 201
    login = client.post(
        "/api/auth/login",
        json={"username": "repeated_cookie_owner", "password": "secret123"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    cookie_name = get_settings().session_cookie_name
    client.cookies.clear()
    cookie_value = f"{cookie_name}={token}"
    cookie_headers = (
        [("Cookie", cookie_value), ("Cookie", cookie_value)]
        if split_headers
        else [("Cookie", f"{cookie_value}; {cookie_value}")]
    )

    response = client.get("/api/users/me", headers=cookie_headers)

    assert response.status_code == 400
    assert response.json() == {"detail": "Multiple authentication credentials"}
    assert token not in response.text


@pytest.mark.parametrize(
    "authorization",
    [
        "",
        "Basic unsupported-credential",
        "Bearer",
        "Bearer ",
        "Bearer token with spaces",
    ],
)
def test_malformed_authorization_never_falls_back_to_cookie(client, authorization):
    register = client.post(
        "/api/auth/register",
        json={
            "username": "malformed_header_owner",
            "password": "secret123",
            "display_name": "Malformed Header Owner",
            "role": "student",
        },
    )
    assert register.status_code == 201
    login = client.post(
        "/api/auth/login",
        json={"username": "malformed_header_owner", "password": "secret123"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]

    response = client.get(
        "/api/users/me",
        headers={"Authorization": authorization},
    )

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid authorization header"}
    assert token not in response.text


def test_session_management_requires_authentication(client):
    sessions = client.get("/api/auth/sessions")
    assert sessions.status_code == 401

    revoke = client.delete("/api/auth/sessions/1")
    assert revoke.status_code == 401


def test_login_records_session_device_metadata_and_last_seen(client):
    register = client.post(
        "/api/auth/register",
        json={
            "username": "device_session_owner",
            "password": "secret123",
            "display_name": "Device Session Owner",
            "role": "teacher",
        },
    )
    assert register.status_code == 201
    login = client.post(
        "/api/auth/login",
        headers={
            "X-Device-Name": "Teacher Lab Laptop",
            "User-Agent": "pytest-login-agent",
            "X-Forwarded-For": "203.0.113.20, 10.0.0.1",
        },
        json={"username": "device_session_owner", "password": "secret123"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    assert login.json()["token_type"] == "bearer"

    sessions_response = client.get(
        "/api/auth/sessions",
        headers={**_auth_header(token), "User-Agent": "pytest-followup-agent"},
    )
    assert sessions_response.status_code == 200
    sessions = sessions_response.json()
    assert len(sessions) == 1
    assert sessions[0]["device_label"] == "Teacher Lab Laptop"
    assert sessions[0]["user_agent"] == "pytest-login-agent"
    assert sessions[0]["last_seen_at"] is not None
    assert sessions[0]["is_current"] is True

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        auth_session = db.scalar(select(AuthSession))
        assert auth_session is not None
        assert auth_session.device_label == "Teacher Lab Laptop"
        assert auth_session.user_agent == "pytest-login-agent"
        assert auth_session.last_seen_at is not None
        assert auth_session.last_seen_ip_hash is not None
        assert len(auth_session.last_seen_ip_hash) == 64
        assert "203.0.113.20" not in auth_session.last_seen_ip_hash


def test_login_sets_secure_cookie_flags_in_production(client, monkeypatch):
    monkeypatch.setenv("ASTRA_ENVIRONMENT", "production")
    get_settings.cache_clear()

    register = client.post(
        "/api/auth/register",
        json={
            "username": "prod_cookie_owner",
            "password": "secret123",
            "display_name": "Production Cookie Owner",
            "role": "student",
        },
    )
    assert register.status_code == 201

    login = client.post(
        "/api/auth/login",
        json={"username": "prod_cookie_owner", "password": "secret123"},
    )

    assert login.status_code == 200
    set_cookie = login.headers["set-cookie"]
    assert get_settings().session_cookie_name in set_cookie
    assert "HttpOnly" in set_cookie
    assert "SameSite=lax" in set_cookie
    assert "Secure" in set_cookie


def test_authenticated_request_refreshes_session_last_seen(client):
    register = client.post(
        "/api/auth/register",
        json={
            "username": "last_seen_owner",
            "password": "secret123",
            "display_name": "Last Seen Owner",
            "role": "student",
        },
    )
    assert register.status_code == 201
    login = client.post("/api/auth/login", json={"username": "last_seen_owner", "password": "secret123"})
    assert login.status_code == 200
    token = login.json()["access_token"]

    old_seen = datetime(2000, 1, 1, tzinfo=UTC)
    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        auth_session = db.scalar(select(AuthSession))
        assert auth_session is not None
        auth_session.last_seen_at = old_seen
        auth_session.last_seen_ip_hash = "old"
        db.commit()

    me = client.get(
        "/api/users/me",
        headers={**_auth_header(token), "X-Forwarded-For": "198.51.100.10", "User-Agent": "pytest-me-agent"},
    )
    assert me.status_code == 200

    with session_factory() as db:
        refreshed_session = db.scalar(select(AuthSession))
        assert refreshed_session is not None
        assert refreshed_session.last_seen_at is not None
        assert refreshed_session.last_seen_at.year >= 2026
        assert refreshed_session.last_seen_ip_hash is not None
        assert refreshed_session.last_seen_ip_hash != "old"
        assert "198.51.100.10" not in refreshed_session.last_seen_ip_hash


def test_session_last_seen_refresh_is_throttled_for_same_ip(client):
    register = client.post(
        "/api/auth/register",
        json={
            "username": "last_seen_throttle_owner",
            "password": "secret123",
            "display_name": "Last Seen Throttle Owner",
            "role": "student",
        },
    )
    assert register.status_code == 201
    login = client.post(
        "/api/auth/login",
        headers={"X-Forwarded-For": "198.51.100.50"},
        json={"username": "last_seen_throttle_owner", "password": "secret123"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        auth_session = db.scalar(select(AuthSession))
        assert auth_session is not None
        recent_seen = datetime.now(UTC)
        auth_session.last_seen_at = recent_seen
        existing_ip_hash = auth_session.last_seen_ip_hash
        db.commit()
        stored_recent_seen = auth_session.last_seen_at

    me = client.get("/api/users/me", headers={**_auth_header(token), "X-Forwarded-For": "198.51.100.50"})
    assert me.status_code == 200

    with session_factory() as db:
        throttled_session = db.scalar(select(AuthSession))
        assert throttled_session is not None
        assert throttled_session.last_seen_at == stored_recent_seen
        assert throttled_session.last_seen_ip_hash == existing_ip_hash


def test_session_last_seen_refreshes_after_throttle_window(client):
    register = client.post(
        "/api/auth/register",
        json={
            "username": "last_seen_window_owner",
            "password": "secret123",
            "display_name": "Last Seen Window Owner",
            "role": "teacher",
        },
    )
    assert register.status_code == 201
    login = client.post(
        "/api/auth/login",
        headers={"X-Forwarded-For": "198.51.100.60"},
        json={"username": "last_seen_window_owner", "password": "secret123"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]

    stale_seen = datetime.now(UTC) - timedelta(seconds=get_settings().session_last_seen_update_seconds + 1)
    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        auth_session = db.scalar(select(AuthSession))
        assert auth_session is not None
        auth_session.last_seen_at = stale_seen
        existing_ip_hash = auth_session.last_seen_ip_hash
        db.commit()
        stored_stale_seen = auth_session.last_seen_at

    me = client.get("/api/users/me", headers={**_auth_header(token), "X-Forwarded-For": "198.51.100.60"})
    assert me.status_code == 200

    with session_factory() as db:
        refreshed_session = db.scalar(select(AuthSession))
        assert refreshed_session is not None
        assert refreshed_session.last_seen_at is not None
        assert refreshed_session.last_seen_at != stored_stale_seen
        assert refreshed_session.last_seen_ip_hash == existing_ip_hash


def test_session_last_seen_refreshes_when_missing(client):
    register = client.post(
        "/api/auth/register",
        json={
            "username": "missing_last_seen_owner",
            "password": "secret123",
            "display_name": "Missing Last Seen Owner",
            "role": "student",
        },
    )
    assert register.status_code == 201
    login = client.post(
        "/api/auth/login",
        headers={"X-Forwarded-For": "198.51.100.70"},
        json={"username": "missing_last_seen_owner", "password": "secret123"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        auth_session = db.scalar(select(AuthSession))
        assert auth_session is not None
        auth_session.last_seen_at = None
        auth_session.last_seen_ip_hash = None
        db.commit()

    me = client.get("/api/users/me", headers={**_auth_header(token), "X-Forwarded-For": "198.51.100.70"})
    assert me.status_code == 200

    with session_factory() as db:
        refreshed_session = db.scalar(select(AuthSession))
        assert refreshed_session is not None
        assert refreshed_session.last_seen_at is not None
        assert refreshed_session.last_seen_ip_hash is not None


def test_session_last_seen_refreshes_when_ip_hash_changes_inside_window(client, monkeypatch):
    monkeypatch.setenv("ASTRA_AUDIT_TRUST_FORWARDED_FOR", "true")
    monkeypatch.setenv("ASTRA_AUDIT_TRUSTED_PROXY_HOSTS", "testclient")
    get_settings.cache_clear()
    register = client.post(
        "/api/auth/register",
        json={
            "username": "last_seen_ip_change_owner",
            "password": "secret123",
            "display_name": "Last Seen IP Change Owner",
            "role": "teacher",
        },
    )
    assert register.status_code == 201
    login = client.post(
        "/api/auth/login",
        headers={"X-Forwarded-For": "198.51.100.80"},
        json={"username": "last_seen_ip_change_owner", "password": "secret123"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        auth_session = db.scalar(select(AuthSession))
        assert auth_session is not None
        recent_seen = datetime.now(UTC)
        auth_session.last_seen_at = recent_seen
        old_ip_hash = auth_session.last_seen_ip_hash
        db.commit()
        stored_recent_seen = auth_session.last_seen_at

    me = client.get("/api/users/me", headers={**_auth_header(token), "X-Forwarded-For": "198.51.100.81"})
    assert me.status_code == 200

    with session_factory() as db:
        refreshed_session = db.scalar(select(AuthSession))
        assert refreshed_session is not None
        assert refreshed_session.last_seen_at != stored_recent_seen
        assert refreshed_session.last_seen_ip_hash != old_ip_hash


def test_session_last_seen_throttle_can_be_disabled(client, monkeypatch):
    register = client.post(
        "/api/auth/register",
        json={
            "username": "last_seen_no_throttle_owner",
            "password": "secret123",
            "display_name": "Last Seen No Throttle Owner",
            "role": "student",
        },
    )
    assert register.status_code == 201
    login = client.post(
        "/api/auth/login",
        headers={"X-Forwarded-For": "198.51.100.90"},
        json={"username": "last_seen_no_throttle_owner", "password": "secret123"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        auth_session = db.scalar(select(AuthSession))
        assert auth_session is not None
        recent_seen = datetime.now(UTC)
        auth_session.last_seen_at = recent_seen
        existing_ip_hash = auth_session.last_seen_ip_hash
        db.commit()
        stored_recent_seen = auth_session.last_seen_at

    monkeypatch.setenv("ASTRA_SESSION_LAST_SEEN_UPDATE_SECONDS", "0")
    get_settings.cache_clear()
    me = client.get("/api/users/me", headers={**_auth_header(token), "X-Forwarded-For": "198.51.100.90"})
    assert me.status_code == 200

    with session_factory() as db:
        refreshed_session = db.scalar(select(AuthSession))
        assert refreshed_session is not None
        assert refreshed_session.last_seen_at != stored_recent_seen
        assert refreshed_session.last_seen_ip_hash == existing_ip_hash


def test_user_can_list_and_revoke_individual_sessions(client):
    register = client.post(
        "/api/auth/register",
        json={
            "username": "session_owner",
            "password": "secret123",
            "display_name": "Session Owner",
            "role": "teacher",
        },
    )
    assert register.status_code == 201
    first_login = client.post("/api/auth/login", json={"username": "session_owner", "password": "secret123"})
    assert first_login.status_code == 200
    first_token = first_login.json()["access_token"]
    second_login = client.post("/api/auth/login", json={"username": "session_owner", "password": "secret123"})
    assert second_login.status_code == 200
    second_token = second_login.json()["access_token"]

    sessions_response = client.get("/api/auth/sessions", headers=_auth_header(second_token))
    assert sessions_response.status_code == 200
    sessions = sessions_response.json()
    assert len(sessions) == 2
    assert sum(1 for auth_session in sessions if auth_session["is_current"]) == 1
    old_session = next(auth_session for auth_session in sessions if not auth_session["is_current"])

    revoke = client.delete(
        f"/api/auth/sessions/{old_session['id']}",
        headers={**_auth_header(second_token), "X-Request-ID": "session-revoke-request"},
    )
    assert revoke.status_code == 200
    assert revoke.json() == {
        "status": "ok",
        "revoked_session_id": old_session["id"],
        "is_current": False,
    }

    old_token_me = client.get("/api/users/me", headers=_auth_header(first_token))
    assert old_token_me.status_code == 401
    current_token_me = client.get("/api/users/me", headers=_auth_header(second_token))
    assert current_token_me.status_code == 200

    active_sessions = client.get("/api/auth/sessions", headers=_auth_header(second_token))
    assert active_sessions.status_code == 200
    assert len(active_sessions.json()) == 1
    assert active_sessions.json()[0]["is_current"] is True

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        revoked_session = db.get(AuthSession, old_session["id"])
        assert revoked_session is not None
        assert revoked_session.revoked_at is not None
        audit = db.scalar(select(AuditLog).where(AuditLog.action == "auth.session.revoke"))
        assert audit is not None
        assert audit.resource_type == "auth_session"
        assert audit.resource_id == str(old_session["id"])
        assert audit.request_id == "session-revoke-request"
        assert audit.snapshot_json == {
            "revoked_session_id": old_session["id"],
            "is_current": False,
            "revoked_sessions": 1,
        }


def test_user_can_revoke_current_session(client):
    register = client.post(
        "/api/auth/register",
        json={
            "username": "current_session_owner",
            "password": "secret123",
            "display_name": "Current Session Owner",
            "role": "student",
        },
    )
    assert register.status_code == 201
    login = client.post("/api/auth/login", json={"username": "current_session_owner", "password": "secret123"})
    assert login.status_code == 200
    token = login.json()["access_token"]

    sessions_response = client.get("/api/auth/sessions", headers=_auth_header(token))
    assert sessions_response.status_code == 200
    current_session = sessions_response.json()[0]
    assert current_session["is_current"] is True

    revoke = client.delete(f"/api/auth/sessions/{current_session['id']}", headers=_auth_header(token))
    assert revoke.status_code == 200
    assert revoke.json()["is_current"] is True
    assert get_settings().session_cookie_name in revoke.headers["set-cookie"]

    after_revoke = client.get("/api/users/me", headers=_auth_header(token))
    assert after_revoke.status_code == 401
    sessions_after_revoke = client.get("/api/auth/sessions", headers=_auth_header(token))
    assert sessions_after_revoke.status_code == 401


def test_user_cannot_revoke_another_users_session(client):
    owner_register = client.post(
        "/api/auth/register",
        json={
            "username": "session_boundary_owner",
            "password": "secret123",
            "display_name": "Session Boundary Owner",
            "role": "teacher",
        },
    )
    assert owner_register.status_code == 201
    other_register = client.post(
        "/api/auth/register",
        json={
            "username": "session_boundary_other",
            "password": "secret123",
            "display_name": "Session Boundary Other",
            "role": "teacher",
        },
    )
    assert other_register.status_code == 201
    owner_login = client.post(
        "/api/auth/login",
        json={"username": "session_boundary_owner", "password": "secret123"},
    )
    assert owner_login.status_code == 200
    owner_token = owner_login.json()["access_token"]
    other_login = client.post(
        "/api/auth/login",
        json={"username": "session_boundary_other", "password": "secret123"},
    )
    assert other_login.status_code == 200
    other_token = other_login.json()["access_token"]

    other_sessions = client.get("/api/auth/sessions", headers=_auth_header(other_token))
    assert other_sessions.status_code == 200
    other_session_id = other_sessions.json()[0]["id"]

    revoke = client.delete(f"/api/auth/sessions/{other_session_id}", headers=_auth_header(owner_token))
    assert revoke.status_code == 404

    other_me = client.get("/api/users/me", headers=_auth_header(other_token))
    assert other_me.status_code == 200
    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        other_session = db.get(AuthSession, other_session_id)
        assert other_session is not None
        assert other_session.revoked_at is None
        audits = db.scalars(select(AuditLog).where(AuditLog.action == "auth.session.revoke")).all()
        assert audits == []


def test_user_cannot_revoke_expired_session(client):
    register = client.post(
        "/api/auth/register",
        json={
            "username": "expired_session_owner",
            "password": "secret123",
            "display_name": "Expired Session Owner",
            "role": "student",
        },
    )
    assert register.status_code == 201
    first_login = client.post("/api/auth/login", json={"username": "expired_session_owner", "password": "secret123"})
    assert first_login.status_code == 200
    second_login = client.post("/api/auth/login", json={"username": "expired_session_owner", "password": "secret123"})
    assert second_login.status_code == 200
    second_token = second_login.json()["access_token"]

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        sessions = db.scalars(select(AuthSession).order_by(AuthSession.id)).all()
        assert len(sessions) == 2
        expired_session_id = sessions[0].id
        active_session_id = sessions[1].id
        sessions[0].expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()

    listed = client.get("/api/auth/sessions", headers=_auth_header(second_token))
    assert listed.status_code == 200
    assert [auth_session["id"] for auth_session in listed.json()] == [active_session_id]

    revoke = client.delete(f"/api/auth/sessions/{expired_session_id}", headers=_auth_header(second_token))
    assert revoke.status_code == 404

    with session_factory() as db:
        expired_session = db.get(AuthSession, expired_session_id)
        assert expired_session is not None
        assert expired_session.revoked_at is None
        audits = db.scalars(select(AuditLog).where(AuditLog.action == "auth.session.revoke")).all()
        assert audits == []


def test_auth_events_record_audit_metadata(client):
    register = client.post(
        "/api/auth/register",
        json={
            "username": "audit_teacher",
            "password": "secret123",
            "display_name": "Audit Teacher",
            "role": "teacher",
        },
    )
    assert register.status_code == 201

    login = client.post(
        "/api/auth/login",
        headers={
            "X-Request-ID": "auth-login-request",
            "X-Forwarded-For": "203.0.113.10, 10.0.0.1",
            "User-Agent": "pytest-auth-agent",
        },
        json={"username": "audit_teacher", "password": "secret123"},
    )
    assert login.status_code == 200
    assert login.headers["X-Request-ID"] == "auth-login-request"
    token = login.json()["access_token"]

    logout = client.post(
        "/api/auth/logout",
        headers={**_auth_header(token), "X-Request-ID": "auth-logout-request"},
    )
    assert logout.status_code == 200

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        login_audit = db.scalar(select(AuditLog).where(AuditLog.action == "auth.login.success"))
        assert login_audit is not None
        assert login_audit.actor_role == "teacher"
        assert login_audit.event_result == "success"
        assert login_audit.request_id == "auth-login-request"
        assert login_audit.client_ip_hash is not None
        assert "203.0.113.10" not in login_audit.client_ip_hash
        assert len(login_audit.client_ip_hash) == 64
        assert login_audit.user_agent == "pytest-auth-agent"
        assert login_audit.request_method == "POST"
        assert login_audit.request_path == "/api/auth/login"
        assert "password" not in login_audit.snapshot_json
        assert "access_token" not in login_audit.snapshot_json

        logout_audit = db.scalar(select(AuditLog).where(AuditLog.action == "auth.logout"))
        assert logout_audit is not None
        assert logout_audit.event_result == "success"
        assert logout_audit.request_id == "auth-logout-request"
        assert logout_audit.snapshot_json["revoked_sessions"] >= 1


def test_public_register_rejects_admin_role(client):
    response = client.post(
        "/api/auth/register",
        json={
            "username": "admin01",
            "password": "secret123",
            "display_name": "Admin One",
            "role": "admin",
        },
    )

    assert response.status_code == 422


def test_register_rejects_weak_password(client):
    response = client.post(
        "/api/auth/register",
        json={
            "username": "weak_teacher",
            "password": "12345678",
            "display_name": "Weak Teacher",
            "role": "teacher",
        },
    )

    assert response.status_code == 422
    assert "Password must include at least one letter" in response.json()["detail"]["password"]


def test_register_rejects_blank_username_after_trimming(client):
    response = client.post(
        "/api/auth/register",
        json={
            "username": "   ",
            "password": "secret123",
            "display_name": "Blank Username",
            "role": "teacher",
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Username is required"


def test_register_rejects_short_username_after_normalization(client):
    response = client.post(
        "/api/auth/register",
        json={
            "username": " A ",
            "password": "secret123",
            "display_name": "Short Username",
            "role": "teacher",
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Username must be at least 3 characters"


def test_register_rejects_blank_display_name_after_trimming(client):
    response = client.post(
        "/api/auth/register",
        json={
            "username": "blank_display_teacher",
            "password": "secret123",
            "display_name": "   ",
            "role": "teacher",
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Display name is required"


def test_register_normalizes_username_and_rejects_case_variant(client):
    register = client.post(
        "/api/auth/register",
        json={
            "username": "MixedTeacher",
            "password": "secret123",
            "display_name": "Mixed Teacher",
            "role": "teacher",
        },
    )
    assert register.status_code == 201
    assert register.json()["username"] == "mixedteacher"
    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        stored = db.scalar(select(User).where(User.username == "mixedteacher"))
        assert stored is not None
        assert stored.normalized_username == "mixedteacher"

    uppercase_login = client.post(
        "/api/auth/login",
        json={"username": "MIXEDTEACHER", "password": "secret123"},
    )
    assert uppercase_login.status_code == 200
    assert uppercase_login.json()["user"]["username"] == "mixedteacher"

    duplicate = client.post(
        "/api/auth/register",
        json={
            "username": "mixedteacher",
            "password": "secret123",
            "display_name": "Duplicate Teacher",
            "role": "teacher",
        },
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "Username already exists"


def test_user_normalized_username_unique_constraint_blocks_case_variants(client):
    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        db.add(
            User(
                username="DbCaseTeacher",
                normalized_username="dbcaseteacher",
                password_hash=hash_password("secret123"),
                display_name="DB Case Teacher",
                role="teacher",
            )
        )
        db.commit()

        db.add(
            User(
                username="dbcaseteacher_shadow",
                normalized_username="dbcaseteacher",
                password_hash=hash_password("secret123"),
                display_name="DB Duplicate Teacher",
                role="teacher",
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()


def test_login_finds_legacy_mixed_case_user_by_normalized_username(client):
    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        db.add(
            User(
                username="LegacyTeacher",
                normalized_username="legacyteacher",
                password_hash=hash_password("secret123"),
                display_name="Legacy Teacher",
                role="teacher",
            )
        )
        db.commit()

    login = client.post(
        "/api/auth/login",
        json={"username": "legacyteacher", "password": "secret123"},
    )
    assert login.status_code == 200
    assert login.json()["user"]["username"] == "LegacyTeacher"

    duplicate = client.post(
        "/api/auth/register",
        json={
            "username": "LEGACYTEACHER",
            "password": "secret123",
            "display_name": "Duplicate Legacy",
            "role": "teacher",
        },
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "Username already exists"


def test_login_rate_limit_locks_and_recovers_after_window(client):
    register = client.post(
        "/api/auth/register",
        json={
            "username": "rate_teacher",
            "password": "secret123",
            "display_name": "Rate Teacher",
            "role": "teacher",
        },
    )
    assert register.status_code == 201

    max_attempts = get_settings().login_max_attempts
    for _ in range(max_attempts - 1):
        response = client.post("/api/auth/login", json={"username": "rate_teacher", "password": "wrong-secret"})
        assert response.status_code == 401

    locked = client.post("/api/auth/login", json={"username": "rate_teacher", "password": "wrong-secret"})
    assert locked.status_code == 429
    assert int(locked.headers["Retry-After"]) > 0

    correct_while_locked = client.post("/api/auth/login", json={"username": "rate_teacher", "password": "secret123"})
    assert correct_while_locked.status_code == 429

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        attempt = db.scalar(select(LoginAttempt).where(LoginAttempt.username == "rate_teacher"))
        assert attempt is not None
        attempt.locked_until = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()

    recovered = client.post("/api/auth/login", json={"username": "rate_teacher", "password": "secret123"})
    assert recovered.status_code == 200

    with session_factory() as db:
        attempt = db.scalar(select(LoginAttempt).where(LoginAttempt.username == "rate_teacher"))
        assert attempt is not None
        assert attempt.failure_count == 0
        assert attempt.locked_until is None
        assert attempt.last_failed_at is None
        failed_audits = db.scalars(
            select(AuditLog).where(AuditLog.action == "auth.login.failed").order_by(AuditLog.id)
        ).all()
        locked_audits = db.scalars(
            select(AuditLog).where(AuditLog.action == "auth.login.locked").order_by(AuditLog.id)
        ).all()
        assert len(failed_audits) == max_attempts - 1
        assert all(audit.event_result == "failure" for audit in failed_audits)
        assert all(audit.failure_reason == "invalid_credentials" for audit in failed_audits)
        assert len(locked_audits) == 2
        assert all(audit.event_result == "blocked" for audit in locked_audits)
        assert all(audit.failure_reason == "account_locked" for audit in locked_audits)


def test_login_rate_limit_uses_normalized_username(client):
    register = client.post(
        "/api/auth/register",
        json={
            "username": "CaseLockTeacher",
            "password": "secret123",
            "display_name": "Case Lock Teacher",
            "role": "teacher",
        },
    )
    assert register.status_code == 201

    max_attempts = get_settings().login_max_attempts
    variants = ["CASELOCKTEACHER", "caselockteacher", "CaseLockTeacher"]
    for index in range(max_attempts):
        response = client.post(
            "/api/auth/login",
            json={"username": variants[index % len(variants)], "password": "wrong-secret"},
        )
        assert response.status_code == (429 if index == max_attempts - 1 else 401)

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        attempts = db.scalars(select(LoginAttempt).order_by(LoginAttempt.id)).all()
        assert [attempt.username for attempt in attempts] == ["caselockteacher"]
        assert [attempt.normalized_username for attempt in attempts] == ["caselockteacher"]
        assert attempts[0].failure_count == max_attempts
        assert attempts[0].locked_until is not None


def test_login_attempt_normalized_username_unique_constraint_blocks_case_variants(client):
    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        db.add(LoginAttempt(username="CaseLockBucket", normalized_username="caselockbucket", failure_count=1))
        db.commit()

        db.add(LoginAttempt(username="caselockbucket_shadow", normalized_username="caselockbucket", failure_count=1))
        with pytest.raises(IntegrityError):
            db.commit()


def test_login_revokes_expired_sessions(client):
    register = client.post(
        "/api/auth/register",
        json={
            "username": "session_teacher",
            "password": "secret123",
            "display_name": "Session Teacher",
            "role": "teacher",
        },
    )
    assert register.status_code == 201

    first_login = client.post("/api/auth/login", json={"username": "session_teacher", "password": "secret123"})
    assert first_login.status_code == 200

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        auth_session = db.scalar(select(AuthSession))
        assert auth_session is not None
        auth_session.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()

    second_login = client.post("/api/auth/login", json={"username": "session_teacher", "password": "secret123"})
    assert second_login.status_code == 200

    with session_factory() as db:
        sessions = db.scalars(select(AuthSession).order_by(AuthSession.id)).all()
        assert len(sessions) == 2
        assert sessions[0].revoked_at is not None
        assert sessions[1].revoked_at is None


def test_password_reset_request_and_confirm_revokes_sessions_without_exposing_secrets(client, monkeypatch):
    monkeypatch.setenv("ASTRA_PASSWORD_RESET_RETURN_TOKEN_FOR_DEV", "true")
    monkeypatch.setenv("ASTRA_PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS", "0")
    get_settings.cache_clear()

    register = client.post(
        "/api/auth/register",
        json={
            "username": "reset_owner",
            "password": "secret123",
            "display_name": "Reset Owner",
            "role": "teacher",
        },
    )
    assert register.status_code == 201
    login = client.post("/api/auth/login", json={"username": "reset_owner", "password": "secret123"})
    assert login.status_code == 200
    old_token = login.json()["access_token"]

    missing_request = client.post("/api/auth/password-reset/request", json={"username": "missing_reset_owner"})
    assert missing_request.status_code == 200
    assert missing_request.json()["status"] == "ok"
    assert missing_request.json()["reset_token"] is None

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        attempt = db.scalar(select(LoginAttempt).where(LoginAttempt.normalized_username == "reset_owner"))
        assert attempt is not None
        attempt.failure_count = 3
        db.commit()

    first_request = client.post(
        "/api/auth/password-reset/request",
        headers={"X-Request-ID": "password-reset-request-1", "User-Agent": "pytest-reset-agent"},
        json={"username": "RESET_OWNER"},
    )
    assert first_request.status_code == 200
    first_token = first_request.json()["reset_token"]
    assert first_token

    second_request = client.post(
        "/api/auth/password-reset/request",
        headers={"X-Request-ID": "password-reset-request-2"},
        json={"username": "reset_owner"},
    )
    assert second_request.status_code == 200
    reset_token = second_request.json()["reset_token"]
    assert reset_token and reset_token != first_token

    first_confirm = client.post(
        "/api/auth/password-reset/confirm",
        json={"token": first_token, "password": "ResetPass123"},
    )
    assert first_confirm.status_code == 400

    weak_confirm = client.post(
        "/api/auth/password-reset/confirm",
        json={"token": reset_token, "password": "12345678"},
    )
    assert weak_confirm.status_code == 422
    assert "Password must include at least one letter" in weak_confirm.json()["detail"]["password"]

    confirm = client.post(
        "/api/auth/password-reset/confirm",
        headers={"X-Request-ID": "password-reset-confirm"},
        json={"token": reset_token, "password": "ResetPass123"},
    )
    assert confirm.status_code == 200
    assert confirm.json() == {"status": "ok", "revoked_sessions": 1, "cleared_login_attempt": True}

    old_session_rejected = client.get("/api/users/me", headers=_auth_header(old_token))
    assert old_session_rejected.status_code == 401
    old_password_login = client.post("/api/auth/login", json={"username": "reset_owner", "password": "secret123"})
    assert old_password_login.status_code == 401
    new_password_login = client.post("/api/auth/login", json={"username": "reset_owner", "password": "ResetPass123"})
    assert new_password_login.status_code == 200

    reused = client.post(
        "/api/auth/password-reset/confirm",
        json={"token": reset_token, "password": "AnotherPass123"},
    )
    assert reused.status_code == 400
    invalid = client.post(
        "/api/auth/password-reset/confirm",
        json={"token": "x" * 32, "password": "AnotherPass123"},
    )
    assert invalid.status_code == 400

    with session_factory() as db:
        reset_tokens = db.scalars(select(PasswordResetToken).order_by(PasswordResetToken.id)).all()
        assert len(reset_tokens) == 2
        assert reset_tokens[0].used_at is not None
        assert reset_tokens[1].used_at is not None
        assert reset_tokens[1].token_hash == hash_token(reset_token)
        assert reset_tokens[1].token_hash != reset_token
        assert reset_tokens[1].requested_username == "reset_owner"
        attempt = db.scalar(select(LoginAttempt).where(LoginAttempt.normalized_username == "reset_owner"))
        assert attempt is not None
        assert attempt.failure_count == 0
        assert attempt.locked_until is None
        revoked_session = db.scalar(select(AuthSession).where(AuthSession.token_hash == hash_token(old_token)))
        assert revoked_session is not None
        assert revoked_session.revoked_at is not None
        request_audit = db.scalar(
            select(AuditLog).where(
                AuditLog.action == "auth.password_reset.request",
                AuditLog.request_id == "password-reset-request-1",
            )
        )
        assert request_audit is not None
        assert request_audit.resource_id != "reset_owner"
        assert "username" not in request_audit.snapshot_json
        assert "accepted" not in request_audit.snapshot_json
        assert request_audit.snapshot_json["cooldown_hit"] is False
        weak_audit = db.scalar(
            select(AuditLog).where(
                AuditLog.action == "auth.password_reset.failed",
                AuditLog.failure_reason == "weak_password",
            )
        )
        assert weak_audit is not None
        assert weak_audit.snapshot_json["reset_token_id"] == reset_tokens[1].id
        success_audit = db.scalar(
            select(AuditLog).where(
                AuditLog.action == "auth.password_reset.success",
                AuditLog.request_id == "password-reset-confirm",
            )
        )
        assert success_audit is not None
        assert success_audit.snapshot_json["revoked_sessions"] == 1
        assert success_audit.snapshot_json["cleared_login_attempt"] is True
        audit_payload = str(success_audit.snapshot_json)
        assert reset_token not in audit_payload
        assert "ResetPass123" not in audit_payload


def test_password_reset_request_uses_cooldown_without_invalidating_existing_token(client, monkeypatch):
    monkeypatch.setenv("ASTRA_PASSWORD_RESET_RETURN_TOKEN_FOR_DEV", "true")
    monkeypatch.setenv("ASTRA_PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS", "300")
    get_settings.cache_clear()

    register = client.post(
        "/api/auth/register",
        json={
            "username": "cooldown_reset_owner",
            "password": "secret123",
            "display_name": "Cooldown Reset Owner",
            "role": "teacher",
        },
    )
    assert register.status_code == 201

    first_request = client.post(
        "/api/auth/password-reset/request",
        headers={"X-Forwarded-For": "198.51.100.201"},
        json={"username": "cooldown_reset_owner"},
    )
    assert first_request.status_code == 200
    first_token = first_request.json()["reset_token"]
    assert first_token

    second_request = client.post(
        "/api/auth/password-reset/request",
        headers={"X-Forwarded-For": "198.51.100.202"},
        json={"username": "cooldown_reset_owner"},
    )
    assert second_request.status_code == 200
    assert second_request.json()["reset_token"] is None

    confirm = client.post(
        "/api/auth/password-reset/confirm",
        json={"token": first_token, "password": "ResetPass123"},
    )
    assert confirm.status_code == 200

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        reset_tokens = db.scalars(select(PasswordResetToken)).all()
        assert len(reset_tokens) == 1
        assert reset_tokens[0].used_at is not None
        blocked_audit = db.scalar(
            select(AuditLog).where(
                AuditLog.action == "auth.password_reset.request",
                AuditLog.failure_reason == "request_cooldown",
            )
        )
        assert blocked_audit is not None
        assert blocked_audit.event_result == "blocked"
        assert blocked_audit.snapshot_json["cooldown_hit"] is True


def test_password_reset_request_in_production_does_not_return_token(client, monkeypatch):
    monkeypatch.setenv("ASTRA_ENVIRONMENT", "production")
    monkeypatch.setenv("ASTRA_PASSWORD_RESET_RETURN_TOKEN_FOR_DEV", "true")
    get_settings.cache_clear()

    register = client.post(
        "/api/auth/register",
        json={
            "username": "production_reset_owner",
            "password": "secret123",
            "display_name": "Production Reset Owner",
            "role": "student",
        },
    )
    assert register.status_code == 201

    reset_request = client.post(
        "/api/auth/password-reset/request",
        headers={"X-Forwarded-For": "198.51.100.210"},
        json={"username": "production_reset_owner"},
    )
    assert reset_request.status_code == 200
    assert reset_request.json()["reset_token"] is None

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        reset_token = db.scalar(select(PasswordResetToken))
        assert reset_token is not None
        assert reset_token.used_at is None


def test_password_reset_disabled_user_request_is_generic_and_confirm_consumes_existing_token(client, monkeypatch):
    monkeypatch.setenv("ASTRA_PASSWORD_RESET_RETURN_TOKEN_FOR_DEV", "true")
    monkeypatch.setenv("ASTRA_PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS", "0")
    get_settings.cache_clear()

    register = client.post(
        "/api/auth/register",
        json={
            "username": "disabled_reset_owner",
            "password": "secret123",
            "display_name": "Disabled Reset Owner",
            "role": "teacher",
        },
    )
    assert register.status_code == 201

    reset_request = client.post("/api/auth/password-reset/request", json={"username": "disabled_reset_owner"})
    assert reset_request.status_code == 200
    reset_token = reset_request.json()["reset_token"]
    assert reset_token

    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        user = db.scalar(select(User).where(User.normalized_username == "disabled_reset_owner"))
        assert user is not None
        user.status = "disabled"
        db.commit()

    disabled_request = client.post("/api/auth/password-reset/request", json={"username": "disabled_reset_owner"})
    assert disabled_request.status_code == 200
    assert disabled_request.json()["reset_token"] is None

    confirm = client.post(
        "/api/auth/password-reset/confirm",
        json={"token": reset_token, "password": "ResetPass123"},
    )
    assert confirm.status_code == 400

    with session_factory() as db:
        reset_tokens = db.scalars(select(PasswordResetToken).order_by(PasswordResetToken.id)).all()
        assert len(reset_tokens) == 1
        assert reset_tokens[0].used_at is not None
        failed_audit = db.scalar(
            select(AuditLog).where(
                AuditLog.action == "auth.password_reset.failed",
                AuditLog.failure_reason == "user_unavailable",
            )
        )
        assert failed_audit is not None


def test_password_reset_confirm_rejects_expired_token(client, monkeypatch):
    monkeypatch.setenv("ASTRA_PASSWORD_RESET_RETURN_TOKEN_FOR_DEV", "true")
    monkeypatch.setenv("ASTRA_PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS", "0")
    get_settings.cache_clear()

    register = client.post(
        "/api/auth/register",
        json={
            "username": "expired_reset_owner",
            "password": "secret123",
            "display_name": "Expired Reset Owner",
            "role": "teacher",
        },
    )
    assert register.status_code == 201
    reset_request = client.post(
        "/api/auth/password-reset/request",
        json={"username": "expired_reset_owner"},
    )
    assert reset_request.status_code == 200
    reset_token = reset_request.json()["reset_token"]
    assert reset_token
    session_factory = get_session_factory(get_settings().database_url)
    with session_factory() as db:
        token_record = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_token(reset_token)))
        assert token_record is not None
        token_record.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()

    confirm = client.post(
        "/api/auth/password-reset/confirm",
        json={"token": reset_token, "password": "ResetPass123"},
    )
    assert confirm.status_code == 400
