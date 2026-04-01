from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import Request, Response
from sqlalchemy.orm import Session

from backend.app.config import get_settings
from backend.app.models import SessionModel
from backend.app.security import sign_value, unsign_value


SESSION_COOKIE_NAME = "spotify_agent_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 30


def generate_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def create_session(db: Session) -> SessionModel:
    now = datetime.now(UTC)
    session = SessionModel(
        id=generate_id("session"),
        created_at=now,
        updated_at=now,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def get_session_id_from_request(request: Request) -> str | None:
    return unsign_value(request.cookies.get(SESSION_COOKIE_NAME))


def get_or_create_session_id(db: Session, request: Request) -> str:
    existing_session_id = get_session_id_from_request(request)
    if existing_session_id:
        return existing_session_id

    return create_session(db).id


def attach_session_cookie(response: Response, session_id: str) -> None:
    secure_cookie = get_settings().app_url.startswith("https://")
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=sign_value(session_id),
        httponly=True,
        samesite="lax",
        secure=secure_cookie,
        path="/",
        max_age=SESSION_MAX_AGE,
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
