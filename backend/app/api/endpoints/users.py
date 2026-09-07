from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user
from app.models import User
from app.schemas.auth import UserPublic
from app.db.session import get_db
from app.schemas.user_note import NoteCreate, NoteRead, NoteUpdate
from app.schemas.user_profile import ProfileUpdate
from app.services import user_notes, user_profile


router = APIRouter()


@router.get("/me", response_model=UserPublic)
def read_current_user(current_user: User = Depends(get_current_user)) -> User:
    return current_user


@router.patch("/me", response_model=UserPublic)
def update_profile(payload: ProfileUpdate, request: Request, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    return user_profile.update_profile(db, current_user, payload, request)


@router.get("/me/notes", response_model=list[NoteRead])
def list_notes(limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return user_notes.list_notes(db, current_user.id, limit, offset)


@router.post("/me/notes", response_model=NoteRead, status_code=201)
def create_note(payload: NoteCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return user_notes.create_note(db, current_user.id, payload)


@router.patch("/me/notes/{note_id}", response_model=NoteRead)
def update_note(note_id: int, payload: NoteUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return user_notes.update_note(db, current_user.id, note_id, payload)


@router.delete("/me/notes/{note_id}", status_code=204)
def delete_note(note_id: int, expected_revision: int = Query(ge=1), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user_notes.delete_note(db, current_user.id, note_id, expected_revision)
    return Response(status_code=204)
