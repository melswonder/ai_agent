from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import requests
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.config import get_settings, require_google_credentials
from backend.app.models import GoogleConnectionModel
from backend.app.security import decrypt_string, encrypt_string


GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3"
GOOGLE_SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/calendar.readonly",
]


def utc_now() -> datetime:
    return datetime.now(UTC)


def ensure_utc_datetime(value: datetime) -> datetime:
    if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def build_google_authorize_url(state: str) -> str:
    settings = get_settings()
    client_id, _ = require_google_credentials()
    query = urlencode(
        {
            "client_id": client_id,
            "redirect_uri": settings.google_callback_url,
            "response_type": "code",
            "scope": " ".join(GOOGLE_SCOPES),
            "access_type": "offline",
            "include_granted_scopes": "true",
            "prompt": "consent",
            "state": state,
        }
    )
    return f"{GOOGLE_AUTH_BASE}?{query}"


def _request_google_tokens(payload: dict[str, str]) -> dict[str, Any]:
    client_id, client_secret = require_google_credentials()
    response = requests.post(
        GOOGLE_TOKEN_URL,
        data={
            **payload,
            "client_id": client_id,
            "client_secret": client_secret,
        },
        timeout=20,
    )

    if not response.ok:
        raise RuntimeError(f"Google token request failed: {response.text}")

    return response.json()


def exchange_google_code_for_tokens(code: str) -> dict[str, Any]:
    settings = get_settings()
    return _request_google_tokens(
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": settings.google_callback_url,
        }
    )


def refresh_google_tokens(refresh_token: str) -> dict[str, Any]:
    return _request_google_tokens(
        {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }
    )


def fetch_google_profile(access_token: str) -> dict[str, Any]:
    response = requests.get(
        GOOGLE_USERINFO_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=20,
    )

    if not response.ok:
        raise RuntimeError(f"Unable to fetch Google profile: {response.text}")

    return response.json()


def get_valid_google_access_token(
    db: Session,
    session_id: str,
    force_refresh: bool = False,
) -> tuple[str, GoogleConnectionModel]:
    connection = db.scalar(
        select(GoogleConnectionModel).where(
            GoogleConnectionModel.session_id == session_id
        )
    )

    if not connection:
        raise RuntimeError("Google Calendar is not connected.")

    cached_access_token = decrypt_string(connection.encrypted_access_token)
    expires_at = ensure_utc_datetime(connection.access_token_expires_at)
    expires_soon = expires_at <= (utc_now() + timedelta(minutes=1))

    if not force_refresh and not expires_soon:
        return cached_access_token, connection

    refresh_token = decrypt_string(connection.encrypted_refresh_token)
    if not refresh_token:
        raise RuntimeError(
            "Google refresh token is missing. Please reconnect Google Calendar."
        )

    refreshed = refresh_google_tokens(refresh_token)
    next_refresh_token = refreshed.get("refresh_token") or refresh_token
    connection.encrypted_access_token = encrypt_string(refreshed["access_token"])
    connection.encrypted_refresh_token = encrypt_string(next_refresh_token)
    connection.access_token_expires_at = utc_now() + timedelta(
        seconds=refreshed["expires_in"]
    )
    connection.scope = refreshed.get("scope") or connection.scope
    connection.updated_at = utc_now()
    db.add(connection)
    db.commit()
    db.refresh(connection)

    return refreshed["access_token"], connection


def google_api_request(
    db: Session,
    session_id: str,
    path: str,
    *,
    method: str = "GET",
    query: dict[str, Any] | None = None,
    body: dict[str, Any] | None = None,
) -> Any:
    url = f"{GOOGLE_CALENDAR_API_BASE}{path}"
    if query:
        url = f"{url}?{urlencode({k: v for k, v in query.items() if v is not None})}"

    def _make_request(access_token: str) -> requests.Response:
        return requests.request(
            method=method,
            url=url,
            headers={
                "Authorization": f"Bearer {access_token}",
                **({"Content-Type": "application/json"} if body else {}),
            },
            data=json.dumps(body) if body else None,
            timeout=20,
        )

    access_token, _ = get_valid_google_access_token(db, session_id)
    response = _make_request(access_token)

    if response.status_code == 401:
        access_token, _ = get_valid_google_access_token(db, session_id, True)
        response = _make_request(access_token)

    if not response.ok:
        raise RuntimeError(f"Google API request failed: {response.text}")

    return response.json()


def list_upcoming_events(
    db: Session,
    session_id: str,
    *,
    max_results: int = 10,
    days: int = 7,
) -> list[dict[str, Any]]:
    time_min = utc_now().replace(microsecond=0).isoformat().replace("+00:00", "Z")
    time_max = (utc_now() + timedelta(days=days)).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )
    response = google_api_request(
        db,
        session_id,
        "/calendars/primary/events",
        query={
            "singleEvents": "true",
            "orderBy": "startTime",
            "timeMin": time_min,
            "timeMax": time_max,
            "maxResults": max_results,
        },
    )

    events: list[dict[str, Any]] = []
    for item in response.get("items", []) or []:
        start = item.get("start") or {}
        end = item.get("end") or {}
        events.append(
            {
                "id": item.get("id"),
                "summary": item.get("summary") or "(No title)",
                "start": start.get("dateTime") or start.get("date"),
                "end": end.get("dateTime") or end.get("date"),
                "htmlLink": item.get("htmlLink"),
                "location": item.get("location"),
                "description": item.get("description"),
                "status": item.get("status"),
            }
        )

    return events
