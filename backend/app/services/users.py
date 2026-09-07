from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import User
from app.core.config import get_settings
from app.core.security import hash_password, password_strength_errors
from app.schemas.auth import RegisterRequest
from app.services.text import require_trimmed_text


def normalize_username(username: str) -> str:
    return username.strip().lower()


def require_normalized_username(username: str, *, min_length: int = 1) -> str:
    normalized = normalize_username(username)
    if not normalized:
        raise HTTPException(status_code=422, detail="Username is required")
    if len(normalized) < min_length:
        raise HTTPException(status_code=422, detail=f"Username must be at least {min_length} characters")
    return normalized


def find_user_by_normalized_username(db: Session, username: str) -> User | None:
    return db.scalar(
        select(User)
        .where(User.normalized_username == normalize_username(username))
        .order_by(User.id)
        .limit(1)
    )


def register_user(db: Session, payload: RegisterRequest) -> User:
    username = require_normalized_username(payload.username, min_length=3)
    display_name = require_trimmed_text(payload.display_name, "Display name is required")
    role = payload.role.strip().lower()
    if role not in {"student", "teacher"}:
        raise HTTPException(status_code=422, detail="Unsupported registration role")
    if role == "teacher" and not get_settings().legacy_local_bootstrap_allowed:
        raise HTTPException(status_code=422, detail="教师身份需要学校核验，请先创建学生账号并提交教师申请。")
    errors = password_strength_errors(payload.password, username=username)
    if errors:
        raise HTTPException(status_code=422, detail={"password": errors})
    if find_user_by_normalized_username(db, username) is not None:
        raise HTTPException(status_code=409, detail="Username already exists")
    user = User(username=username, normalized_username=username, display_name=display_name,
                role=role, password_hash=hash_password(payload.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username already exists")
    db.refresh(user)
    return user
