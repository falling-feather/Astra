from fastapi import Request
from sqlalchemy.orm import Session

from app.models import User
from app.schemas.user_profile import ProfileUpdate
from app.services.audit import record_audit_log


def update_profile(db: Session, actor: User, payload: ProfileUpdate, request: Request) -> User:
    actor.display_name = payload.display_name
    record_audit_log(
        db, actor=actor, action="user.profile.update", resource_type="user",
        resource_id=actor.id, request=request, snapshot={"display_name": payload.display_name},
    )
    db.commit()
    db.refresh(actor)
    return actor
