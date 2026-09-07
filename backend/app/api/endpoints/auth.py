from datetime import UTC, datetime, timedelta
from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps.auth import AuthContext, get_current_auth_context, get_current_user
from app.core.config import get_settings
from app.core.security import create_session_token, hash_password, hash_token, password_strength_errors, verify_password
from app.db.session import get_db
from app.models import AuditLog, AuthSession, LoginAttempt, PasswordResetToken, User
from app.schemas.auth import (
    AuthSessionPublic,
    AuthSessionRevokeResponse,
    LoginRequest,
    LoginResponse,
    PasswordResetConfirmRequest,
    PasswordResetConfirmResponse,
    PasswordResetRequest,
    PasswordResetRequestResponse,
    RegisterRequest,
    UserPublic,
)
from app.services.audit import record_audit_log
from app.services.request_metadata import request_client_ip_hash, request_device_label, request_user_agent
from app.services.text import require_trimmed_text
from app.services.users import find_user_by_normalized_username, require_normalized_username, register_user


router = APIRouter()


@router.post("/register", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> User:
    return register_user(db, payload)


@router.post("/login", response_model=LoginResponse)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> LoginResponse:
    username = require_normalized_username(payload.username)

    settings = get_settings()
    now = datetime.now(UTC)
    attempt = _get_login_attempt(db, username)
    _reset_expired_lockout(attempt, now)
    if _is_login_locked(attempt, now):
        retry_after = _retry_after_seconds(attempt, now)
        _record_login_locked(db, request, username, attempt, retry_after)
        db.commit()
        _raise_login_locked(retry_after)

    user = find_user_by_normalized_username(db, username)
    if user is None or not verify_password(payload.password, user.password_hash):
        locked = _record_failed_login(db, attempt, now, settings.login_max_attempts, settings.login_lockout_seconds)
        retry_after = _retry_after_seconds(attempt, now) if locked else None
        if locked:
            _record_login_locked(db, request, username, attempt, retry_after or 1)
        else:
            _record_login_failure(db, request, username, attempt)
        db.commit()
        if locked:
            _raise_login_locked(retry_after or 1)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    if user.status != "active":
        record_audit_log(
            db,
            actor=None,
            action="auth.login.failed",
            resource_type="user",
            resource_id=user.id,
            event_result="failure",
            failure_reason="user_disabled",
            request=request,
            snapshot={"username": user.username, "status": user.status},
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is disabled")

    token = create_session_token()
    _clear_login_attempt(attempt)
    _revoke_expired_sessions(db, now)
    auth_session = AuthSession(
        user_id=user.id,
        token_hash=hash_token(token),
        device_label=request_device_label(request),
        user_agent=request_user_agent(request),
        expires_at=now + timedelta(days=settings.session_days),
        last_seen_at=now,
        last_seen_ip_hash=request_client_ip_hash(request),
    )
    db.add(auth_session)
    record_audit_log(
        db,
        actor=user,
        action="auth.login.success",
        resource_type="user",
        resource_id=user.id,
        event_result="success",
        request=request,
        snapshot={"username": user.username, "role": user.role, "device_label": auth_session.device_label},
    )
    db.commit()
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=settings.session_days * 24 * 60 * 60,
        httponly=True,
        samesite="lax",
        secure=settings.is_production_like,
    )
    return LoginResponse(user=UserPublic.model_validate(user), access_token=token)


@router.post("/password-reset/request", response_model=PasswordResetRequestResponse)
def request_password_reset(
    payload: PasswordResetRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> PasswordResetRequestResponse:
    username = require_normalized_username(payload.username)
    settings = get_settings()
    now = datetime.now(UTC)
    expires_at = now + timedelta(seconds=settings.password_reset_token_ttl_seconds)
    reset_token_value: str | None = None
    subject_hash = _password_reset_subject_hash(username)
    client_ip_hash = request_client_ip_hash(request)
    cooldown_hit = _password_reset_request_is_in_cooldown(db, subject_hash, client_ip_hash, now)
    user = find_user_by_normalized_username(db, username)
    accepted = user is not None and user.status == "active"
    if accepted and not cooldown_hit:
        _expire_password_reset_tokens(db, user, now)
        reset_token_value = create_session_token()
        db.add(
            PasswordResetToken(
                user_id=user.id,
                token_hash=hash_token(reset_token_value),
                requested_username=username,
                requested_ip_hash=client_ip_hash,
                user_agent=request_user_agent(request),
                expires_at=expires_at,
            )
        )
    record_audit_log(
        db,
        actor=None,
        action="auth.password_reset.request",
        resource_type="auth_password_reset",
        resource_id=subject_hash,
        event_result="blocked" if cooldown_hit else "success",
        failure_reason="request_cooldown" if cooldown_hit else None,
        request=request,
        snapshot={
            "expires_in_seconds": settings.password_reset_token_ttl_seconds,
            "cooldown_seconds": settings.password_reset_request_cooldown_seconds,
            "cooldown_hit": cooldown_hit,
        },
    )
    db.commit()
    return PasswordResetRequestResponse(
        expires_in_seconds=settings.password_reset_token_ttl_seconds,
        reset_token=reset_token_value if _should_return_password_reset_token(settings) else None,
    )


@router.post("/password-reset/confirm", response_model=PasswordResetConfirmResponse)
def confirm_password_reset(
    payload: PasswordResetConfirmRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> PasswordResetConfirmResponse:
    now = datetime.now(UTC)
    reset_token_hash = hash_token(payload.token)
    reset_token = db.scalar(
        select(PasswordResetToken)
        .where(PasswordResetToken.token_hash == reset_token_hash)
        .with_for_update()
    )
    if reset_token is None or reset_token.used_at is not None or _as_utc(reset_token.expires_at) <= now:
        record_audit_log(
            db,
            actor=None,
            action="auth.password_reset.failed",
            resource_type="auth_password_reset",
            event_result="failure",
            failure_reason="invalid_or_expired_token",
            request=request,
            snapshot={},
        )
        db.commit()
        raise HTTPException(status_code=400, detail="Invalid or expired password reset token")

    user = db.get(User, reset_token.user_id)
    if user is None or user.status != "active":
        reset_token.used_at = now
        record_audit_log(
            db,
            actor=None,
            action="auth.password_reset.failed",
            resource_type="auth_password_reset",
            resource_id=reset_token.id,
            event_result="failure",
            failure_reason="user_unavailable",
            request=request,
            snapshot={"reset_token_id": reset_token.id},
        )
        db.commit()
        raise HTTPException(status_code=400, detail="Invalid or expired password reset token")

    password_errors = password_strength_errors(payload.password, username=user.username)
    if password_errors:
        record_audit_log(
            db,
            actor=user,
            action="auth.password_reset.failed",
            resource_type="user",
            resource_id=user.id,
            event_result="failure",
            failure_reason="weak_password",
            request=request,
            snapshot={"reset_token_id": reset_token.id},
        )
        db.commit()
        raise HTTPException(status_code=422, detail={"password": password_errors})

    reset_token.used_at = now
    user.password_hash = hash_password(payload.password)
    cleared_login_attempt = _clear_user_login_attempt(db, user)
    revoked_sessions = _revoke_user_sessions(db, user, now)
    record_audit_log(
        db,
        actor=user,
        action="auth.password_reset.success",
        resource_type="user",
        resource_id=user.id,
        event_result="success",
        request=request,
        snapshot={
            "reset_token_id": reset_token.id,
            "requested_username": reset_token.requested_username,
            "revoked_sessions": revoked_sessions,
            "cleared_login_attempt": cleared_login_attempt,
        },
    )
    db.commit()
    return PasswordResetConfirmResponse(
        revoked_sessions=revoked_sessions,
        cleared_login_attempt=cleared_login_attempt,
    )


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    settings = get_settings()
    auth_sessions = db.scalars(
        select(AuthSession).where(
            AuthSession.user_id == current_user.id,
            AuthSession.revoked_at.is_(None),
        )
    ).all()
    now = datetime.now(UTC)
    for auth_session in auth_sessions:
        auth_session.revoked_at = now
    record_audit_log(
        db,
        actor=current_user,
        action="auth.logout",
        resource_type="user",
        resource_id=current_user.id,
        event_result="success",
        request=request,
        snapshot={"revoked_sessions": len(auth_sessions)},
    )
    db.commit()
    response.delete_cookie(settings.session_cookie_name)
    return {"status": "ok"}


@router.get("/sessions", response_model=list[AuthSessionPublic])
def list_sessions(
    context: AuthContext = Depends(get_current_auth_context),
    db: Session = Depends(get_db),
) -> list[AuthSessionPublic]:
    now = datetime.now(UTC)
    auth_sessions = db.scalars(
        select(AuthSession)
        .where(
            AuthSession.user_id == context.user.id,
            AuthSession.revoked_at.is_(None),
            AuthSession.expires_at > now,
        )
        .order_by(AuthSession.created_at.desc(), AuthSession.id.desc())
    ).all()
    return [_session_public(auth_session, context.session.id) for auth_session in auth_sessions]


@router.delete("/sessions/{session_id}", response_model=AuthSessionRevokeResponse)
def revoke_session(
    session_id: int,
    request: Request,
    response: Response,
    context: AuthContext = Depends(get_current_auth_context),
    db: Session = Depends(get_db),
) -> AuthSessionRevokeResponse:
    now = datetime.now(UTC)
    auth_session = db.scalar(
        select(AuthSession).where(
            AuthSession.id == session_id,
            AuthSession.user_id == context.user.id,
            AuthSession.revoked_at.is_(None),
            AuthSession.expires_at > now,
        )
    )
    if auth_session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    auth_session.revoked_at = now
    is_current = auth_session.id == context.session.id
    record_audit_log(
        db,
        actor=context.user,
        action="auth.session.revoke",
        resource_type="auth_session",
        resource_id=auth_session.id,
        event_result="success",
        request=request,
        snapshot={
            "revoked_session_id": auth_session.id,
            "is_current": is_current,
            "revoked_sessions": 1,
        },
    )
    db.commit()
    if is_current:
        response.delete_cookie(get_settings().session_cookie_name)
    return AuthSessionRevokeResponse(revoked_session_id=auth_session.id, is_current=is_current)


def _get_login_attempt(db: Session, username: str) -> LoginAttempt:
    statement = select(LoginAttempt).where(LoginAttempt.normalized_username == username).with_for_update()
    attempt = db.scalar(statement)
    if attempt is None:
        attempt = LoginAttempt(username=username, normalized_username=username, failure_count=0)
        try:
            with db.begin_nested():
                db.add(attempt)
                db.flush()
        except IntegrityError:
            attempt = db.scalar(statement)
            if attempt is None:
                raise
    return attempt


def _record_failed_login(
    db: Session,
    attempt: LoginAttempt,
    now: datetime,
    max_attempts: int,
    lockout_seconds: int,
) -> bool:
    window_seconds = max(1, get_settings().login_attempt_window_seconds)
    if attempt.last_failed_at is None or _as_utc(attempt.last_failed_at) <= now - timedelta(seconds=window_seconds):
        attempt.failure_count = 0
    attempt.failure_count += 1
    attempt.last_failed_at = now
    if attempt.failure_count >= max(1, max_attempts):
        attempt.locked_until = now + timedelta(seconds=max(1, lockout_seconds))
        db.flush()
        return True
    db.flush()
    return False


def _clear_login_attempt(attempt: LoginAttempt) -> None:
    attempt.failure_count = 0
    attempt.locked_until = None
    attempt.last_failed_at = None


def _reset_expired_lockout(attempt: LoginAttempt, now: datetime) -> None:
    if attempt.locked_until is not None and _as_utc(attempt.locked_until) <= now:
        _clear_login_attempt(attempt)


def _is_login_locked(attempt: LoginAttempt, now: datetime) -> bool:
    return attempt.locked_until is not None and _as_utc(attempt.locked_until) > now


def _retry_after_seconds(attempt: LoginAttempt, now: datetime) -> int:
    locked_until = _as_utc(attempt.locked_until) if attempt.locked_until else now
    return max(1, ceil((locked_until - now).total_seconds()))


def _raise_login_locked(retry_after: int) -> None:
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Too many failed login attempts",
        headers={"Retry-After": str(retry_after)},
    )


def _record_login_failure(db: Session, request: Request, username: str, attempt: LoginAttempt) -> None:
    record_audit_log(
        db,
        actor=None,
        action="auth.login.failed",
        resource_type="auth_login",
        resource_id=username,
        event_result="failure",
        failure_reason="invalid_credentials",
        request=request,
        snapshot={"username": username, "failure_count": attempt.failure_count},
    )


def _record_login_locked(
    db: Session,
    request: Request,
    username: str,
    attempt: LoginAttempt,
    retry_after: int,
) -> None:
    record_audit_log(
        db,
        actor=None,
        action="auth.login.locked",
        resource_type="auth_login",
        resource_id=username,
        event_result="blocked",
        failure_reason="account_locked",
        request=request,
        snapshot={
            "username": username,
            "failure_count": attempt.failure_count,
            "retry_after": retry_after,
        },
    )


def _revoke_expired_sessions(db: Session, now: datetime) -> None:
    expired_sessions = db.scalars(
        select(AuthSession).where(AuthSession.revoked_at.is_(None), AuthSession.expires_at <= now)
    ).all()
    for auth_session in expired_sessions:
        auth_session.revoked_at = now


def _revoke_user_sessions(db: Session, user: User, now: datetime) -> int:
    auth_sessions = db.scalars(
        select(AuthSession).where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None))
    ).all()
    for auth_session in auth_sessions:
        auth_session.revoked_at = now
    return len(auth_sessions)


def _clear_user_login_attempt(db: Session, user: User) -> bool:
    attempt = db.scalar(select(LoginAttempt).where(LoginAttempt.normalized_username == user.normalized_username))
    if attempt is None:
        return False
    _clear_login_attempt(attempt)
    return True


def _expire_password_reset_tokens(db: Session, user: User, now: datetime) -> None:
    reset_tokens = db.scalars(
        select(PasswordResetToken).where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.expires_at > now,
        )
    ).all()
    for reset_token in reset_tokens:
        reset_token.used_at = now


def _password_reset_subject_hash(username: str) -> str:
    return hash_token(f"password-reset:{get_settings().audit_ip_hash_salt}:{username}")


def _should_return_password_reset_token(settings) -> bool:
    return settings.password_reset_return_token_for_dev and settings.is_local_development


def _password_reset_request_is_in_cooldown(
    db: Session,
    subject_hash: str,
    client_ip_hash: str | None,
    now: datetime,
) -> bool:
    cooldown_seconds = get_settings().password_reset_request_cooldown_seconds
    if cooldown_seconds <= 0:
        return False
    cutoff = now - timedelta(seconds=cooldown_seconds)
    subject_recent = db.scalar(
        select(AuditLog.id).where(
            AuditLog.action == "auth.password_reset.request",
            AuditLog.resource_id == subject_hash,
            AuditLog.created_at >= cutoff,
        )
    )
    if subject_recent is not None:
        return True
    if client_ip_hash is None:
        return False
    ip_recent = db.scalar(
        select(AuditLog.id).where(
            AuditLog.action == "auth.password_reset.request",
            AuditLog.client_ip_hash == client_ip_hash,
            AuditLog.created_at >= cutoff,
        )
    )
    return ip_recent is not None


def _session_public(auth_session: AuthSession, current_session_id: int) -> AuthSessionPublic:
    return AuthSessionPublic(
        id=auth_session.id,
        device_label=auth_session.device_label,
        user_agent=auth_session.user_agent,
        created_at=auth_session.created_at,
        expires_at=auth_session.expires_at,
        last_seen_at=auth_session.last_seen_at,
        revoked_at=auth_session.revoked_at,
        is_current=auth_session.id == current_session_id,
    )


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
