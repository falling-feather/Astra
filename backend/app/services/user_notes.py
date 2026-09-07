from fastapi import HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.models import UserNote
from app.models.base import utc_now
from app.schemas.user_note import NoteCreate, NoteUpdate


def list_notes(db: Session, user_id: int, limit: int, offset: int) -> list[UserNote]:
    return list(db.scalars(select(UserNote).where(UserNote.user_id == user_id).order_by(UserNote.updated_at.desc(), UserNote.id.desc()).limit(limit).offset(offset)))


def create_note(db: Session, user_id: int, payload: NoteCreate) -> UserNote:
    note = UserNote(user_id=user_id, title=payload.title, content=payload.content)
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


def _owned_note(db: Session, user_id: int, note_id: int) -> UserNote:
    note = db.scalar(select(UserNote).where(UserNote.id == note_id, UserNote.user_id == user_id))
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


def update_note(db: Session, user_id: int, note_id: int, payload: NoteUpdate) -> UserNote:
    _owned_note(db, user_id, note_id)
    result = db.execute(update(UserNote).where(UserNote.id == note_id, UserNote.user_id == user_id, UserNote.revision == payload.expected_revision).values(title=payload.title, content=payload.content, revision=UserNote.revision + 1, updated_at=utc_now()))
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(status_code=409, detail="Note changed; reload before saving")
    db.commit()
    return _owned_note(db, user_id, note_id)


def delete_note(db: Session, user_id: int, note_id: int, expected_revision: int) -> None:
    _owned_note(db, user_id, note_id)
    result = db.execute(delete(UserNote).where(UserNote.id == note_id, UserNote.user_id == user_id, UserNote.revision == expected_revision))
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(status_code=409, detail="Note changed; reload before deleting")
    db.commit()
