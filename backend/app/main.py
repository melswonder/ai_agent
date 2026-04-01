from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import Depends, FastAPI, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from backend.app.agent import run_music_agent
from backend.app.config import get_settings
from backend.app.db import get_db
from backend.app.models import ChatMessageModel, SessionModel, SpotifyConnectionModel
from backend.app.schemas import ChatPayload, DevicePayload
from backend.app.security import encrypt_string
from backend.app.session import (
    attach_session_cookie,
    clear_session_cookie,
    generate_id,
    get_or_create_session_id,
    get_session_id_from_request,
)
from backend.app.spotify import (
    build_spotify_authorize_url,
    create_pkce_pair,
    exchange_code_for_tokens,
    fetch_spotify_profile,
    get_browser_playback_token,
    get_current_playback_state,
    set_preferred_player_device,
)


logger = logging.getLogger(__name__)
app = FastAPI(title="Spotify Chat Python Backend")


def is_spotify_configured() -> bool:
    return get_settings().spotify_configured


def is_llm_configured() -> bool:
    return get_settings().llm_configured


def create_empty_state() -> dict[str, Any]:
    settings = get_settings()
    return {
        "authenticated": False,
        "spotifyConfigured": settings.spotify_configured,
        "llmConfigured": settings.llm_configured,
        "deviceReady": False,
        "callbackUrl": settings.spotify_callback_url,
        "profile": None,
        "messages": [],
        "playback": None,
    }


def get_conversation(db: Session, session_id: str) -> list[ChatMessageModel]:
    return list(
        db.scalars(
            select(ChatMessageModel)
            .where(ChatMessageModel.session_id == session_id)
            .order_by(ChatMessageModel.created_at.asc())
        )
    )


def get_recent_conversation(
    db: Session, session_id: str, limit: int = 16
) -> list[ChatMessageModel]:
    messages = list(
        db.scalars(
            select(ChatMessageModel)
            .where(ChatMessageModel.session_id == session_id)
            .order_by(ChatMessageModel.created_at.desc())
            .limit(limit)
        )
    )
    messages.reverse()
    return messages


def save_chat_message(
    db: Session,
    session_id: str,
    role: str,
    content: str,
) -> ChatMessageModel:
    record = ChatMessageModel(
        id=generate_id("msg"),
        session_id=session_id,
        role=role,
        content=content.strip(),
        created_at=datetime.now(UTC),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def to_chat_message_dto(messages: list[ChatMessageModel]) -> list[dict[str, Any]]:
    return [
        {
            "id": message.id,
            "role": "user" if message.role == "USER" else "assistant",
            "content": message.content,
            "createdAt": message.created_at.isoformat(),
        }
        for message in messages
    ]


def build_friendly_error(error: Exception) -> str:
    message = str(error)
    if (
        "NO_ACTIVE_DEVICE" in message
        or "No active device found" in message
        or "Player command failed" in message
    ):
        return "再生先デバイスが見つかりませんでした。Spotify を接続したブラウザでプレイヤーが準備できているか確認してください。"

    if "OPENAI_API_KEY" in message:
        return "LLM の設定がまだないため、チャットで曲変更できません。OPENAI_API_KEY を設定してください。"

    return "うまく操作を完了できませんでした。Spotify 接続とプレイヤー準備状況を確認して、もう一度試してください。"


def redirect_with_error(auth_error: str) -> RedirectResponse:
    url = f"{get_settings().app_url}/?authError={auth_error}"
    return RedirectResponse(url, status_code=307)


@app.get("/api/auth/spotify/login")
def spotify_login(request: Request, db: Session = Depends(get_db)) -> Response:
    if not is_spotify_configured():
        return JSONResponse(
            {"error": "Spotify credentials are not configured on the server."},
            status_code=503,
        )

    session_id = get_or_create_session_id(db, request)
    state = generate_id("state")
    verifier, challenge = create_pkce_pair()

    session = db.scalar(select(SessionModel).where(SessionModel.id == session_id))
    if not session:
        session = SessionModel(
            id=session_id,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        db.add(session)

    session.oauth_state = state
    session.oauth_verifier = verifier
    session.updated_at = datetime.now(UTC)
    db.add(session)
    db.commit()

    response = RedirectResponse(
        build_spotify_authorize_url(state, challenge),
        status_code=307,
    )
    attach_session_cookie(response, session_id)
    return response


@app.get("/callbacks")
def spotify_callback(request: Request, db: Session = Depends(get_db)) -> Response:
    if not is_spotify_configured():
        return redirect_with_error("spotify_config_missing")

    auth_error = request.query_params.get("error")
    code = request.query_params.get("code")
    state = request.query_params.get("state")

    if auth_error:
        return redirect_with_error(auth_error)

    if not code or not state:
        return redirect_with_error("oauth_state_invalid")

    session = db.scalar(select(SessionModel).where(SessionModel.oauth_state == state))
    if not session or not session.oauth_verifier:
        return redirect_with_error("oauth_state_invalid")

    try:
        tokens = exchange_code_for_tokens(code, session.oauth_verifier)
        profile = fetch_spotify_profile(tokens["access_token"])
        encrypted_access_token = encrypt_string(tokens["access_token"])
        encrypted_refresh_token = encrypt_string(tokens.get("refresh_token", ""))
        access_token_expires_at = datetime.now(UTC) + timedelta(
            seconds=tokens["expires_in"]
        )

        previous_connection = db.scalar(
            select(SpotifyConnectionModel).where(
                or_(
                    SpotifyConnectionModel.session_id == session.id,
                    SpotifyConnectionModel.spotify_user_id == profile["id"],
                )
            )
        )
        previous_device_id = (
            previous_connection.player_device_id if previous_connection else None
        )

        db.execute(
            delete(SpotifyConnectionModel).where(
                or_(
                    SpotifyConnectionModel.session_id == session.id,
                    SpotifyConnectionModel.spotify_user_id == profile["id"],
                )
            )
        )

        db.add(
            SpotifyConnectionModel(
                id=generate_id("conn"),
                session_id=session.id,
                spotify_user_id=profile["id"],
                display_name=profile.get("display_name"),
                scope=tokens.get("scope", ""),
                encrypted_access_token=encrypted_access_token,
                encrypted_refresh_token=encrypted_refresh_token,
                access_token_expires_at=access_token_expires_at,
                player_device_id=previous_device_id,
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        session.oauth_state = None
        session.oauth_verifier = None
        session.updated_at = datetime.now(UTC)
        db.add(session)
        db.commit()

        response = RedirectResponse(get_settings().app_url, status_code=307)
        attach_session_cookie(response, session.id)
        return response
    except Exception:
        logger.exception("Spotify callback failed")
        db.rollback()
        return redirect_with_error("token_exchange_failed")


@app.post("/api/auth/logout")
def logout(request: Request, db: Session = Depends(get_db)) -> Response:
    session_id = get_session_id_from_request(request)
    if session_id:
        db.execute(
            delete(SpotifyConnectionModel).where(
                SpotifyConnectionModel.session_id == session_id
            )
        )
        db.commit()

    response = JSONResponse({"ok": True})
    clear_session_cookie(response)
    return response


@app.get("/api/session")
def get_session_state(request: Request, db: Session = Depends(get_db)) -> Response:
    session_id = get_session_id_from_request(request)
    if not session_id:
        return JSONResponse(create_empty_state())

    session = db.scalar(select(SessionModel).where(SessionModel.id == session_id))
    if not session:
        return JSONResponse(create_empty_state())

    connection = db.scalar(
        select(SpotifyConnectionModel).where(
            SpotifyConnectionModel.session_id == session_id
        )
    )
    messages = get_conversation(db, session_id)
    playback = None
    if connection:
        try:
            playback = get_current_playback_state(db, session_id)
        except Exception:
            logger.exception("Unable to read playback for session payload")

    return JSONResponse(
        {
            "authenticated": bool(connection),
            "spotifyConfigured": is_spotify_configured(),
            "llmConfigured": is_llm_configured(),
            "deviceReady": bool(connection and connection.player_device_id),
            "callbackUrl": get_settings().spotify_callback_url,
            "profile": {
                "displayName": connection.display_name,
                "spotifyUserId": connection.spotify_user_id,
            }
            if connection
            else None,
            "messages": to_chat_message_dto(messages),
            "playback": playback,
        }
    )


@app.get("/api/playback")
def playback(request: Request, db: Session = Depends(get_db)) -> Response:
    session_id = get_session_id_from_request(request)
    if not session_id:
        return JSONResponse({"error": "Not authenticated."}, status_code=401)

    connection = db.scalar(
        select(SpotifyConnectionModel).where(
            SpotifyConnectionModel.session_id == session_id
        )
    )
    if not connection:
        return JSONResponse({"error": "Spotify is not connected."}, status_code=401)

    try:
        current_playback = get_current_playback_state(db, session_id)
    except Exception:
        logger.exception("Unable to read playback state")
        return JSONResponse(
            {
                "playback": None,
                "deviceReady": bool(connection.player_device_id),
                "error": "Unable to read playback state.",
            },
            status_code=200,
        )

    return JSONResponse(
        {
            "playback": current_playback,
            "deviceReady": bool(connection.player_device_id),
        }
    )


@app.get("/api/spotify/token")
def browser_playback_token(request: Request, db: Session = Depends(get_db)) -> Response:
    session_id = get_session_id_from_request(request)
    if not session_id:
        return JSONResponse({"error": "Not authenticated."}, status_code=401)

    try:
        access_token = get_browser_playback_token(db, session_id)
        return JSONResponse({"accessToken": access_token})
    except Exception:
        logger.exception("Unable to retrieve Spotify playback token")
        return JSONResponse(
            {"error": "Unable to retrieve a Spotify playback token."},
            status_code=401,
        )


@app.post("/api/player/device")
def register_player_device(
    payload: DevicePayload,
    request: Request,
    db: Session = Depends(get_db),
) -> Response:
    session_id = get_session_id_from_request(request)
    if not session_id:
        return JSONResponse({"error": "Not authenticated."}, status_code=401)

    set_preferred_player_device(db, session_id, payload.deviceId)
    playback = get_current_playback_state(db, session_id)
    return JSONResponse({"ok": True, "playback": playback})


@app.delete("/api/chat/history")
def clear_chat_history(request: Request, db: Session = Depends(get_db)) -> Response:
    session_id = get_session_id_from_request(request)
    if not session_id:
        return JSONResponse({"ok": True, "deletedCount": 0})

    deleted = db.execute(
        delete(ChatMessageModel).where(ChatMessageModel.session_id == session_id)
    )
    db.commit()
    return JSONResponse({"ok": True, "deletedCount": deleted.rowcount or 0})


@app.post("/api/chat")
def chat(
    payload: ChatPayload,
    request: Request,
    db: Session = Depends(get_db),
) -> Response:
    session_id = get_session_id_from_request(request)
    if not session_id:
        return JSONResponse({"error": "Not authenticated."}, status_code=401)

    if not is_llm_configured():
        return JSONResponse(
            {"error": "OPENAI_API_KEY is not configured."},
            status_code=503,
        )

    connection = db.scalar(
        select(SpotifyConnectionModel).where(
            SpotifyConnectionModel.session_id == session_id
        )
    )
    if not connection:
        return JSONResponse({"error": "Spotify is not connected."}, status_code=401)

    history = get_recent_conversation(db, session_id, 18)
    save_chat_message(db, session_id, "USER", payload.message)

    try:
        result = run_music_agent(
            db,
            session_id,
            [
                {"role": message.role, "content": message.content}
                for message in history
            ],
            payload.message,
        )
        assistant_record = save_chat_message(
            db,
            session_id,
            "ASSISTANT",
            result["assistantMessage"],
        )
        messages = get_conversation(db, session_id)
        playback = get_current_playback_state(db, session_id)
        return JSONResponse(
            {
                "messages": to_chat_message_dto(messages),
                "playback": playback,
                "assistantMessage": {
                    "id": assistant_record.id,
                    "role": "assistant",
                    "content": assistant_record.content,
                    "createdAt": assistant_record.created_at.isoformat(),
                },
            }
        )
    except Exception as error:
        logger.exception("Chat request failed")
        fallback = save_chat_message(
            db,
            session_id,
            "ASSISTANT",
            build_friendly_error(error),
        )
        messages = get_conversation(db, session_id)
        playback = None
        try:
            playback = get_current_playback_state(db, session_id)
        except Exception:
            logger.exception("Unable to refresh playback after chat failure")

        return JSONResponse(
            {
                "messages": to_chat_message_dto(messages),
                "playback": playback,
                "assistantMessage": {
                    "id": fallback.id,
                    "role": "assistant",
                    "content": fallback.content,
                    "createdAt": fallback.created_at.isoformat(),
                },
            },
            status_code=500,
        )
