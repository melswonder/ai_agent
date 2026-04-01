from __future__ import annotations

import base64
import hashlib
import json
import os
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import requests
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.config import (
    get_settings,
    require_spotify_credentials,
)
from backend.app.models import SpotifyConnectionModel
from backend.app.security import decrypt_string, encrypt_string


SPOTIFY_ACCOUNT_BASE = "https://accounts.spotify.com"
SPOTIFY_API_BASE = "https://api.spotify.com/v1"
SPOTIFY_SCOPES = [
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing",
    "playlist-read-private",
    "playlist-read-collaborative",
    "user-library-read",
]


def utc_now() -> datetime:
    return datetime.now(UTC)


def ensure_utc_datetime(value: datetime) -> datetime:
    if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def create_pkce_pair() -> tuple[str, str]:
    verifier = _base64url_encode(os.urandom(64))
    challenge = _base64url_encode(hashlib.sha256(verifier.encode("utf-8")).digest())
    return verifier, challenge


def build_spotify_authorize_url(state: str, code_challenge: str) -> str:
    settings = get_settings()
    client_id, _ = require_spotify_credentials()
    query = urlencode(
        {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": settings.spotify_callback_url,
            "scope": " ".join(SPOTIFY_SCOPES),
            "state": state,
            "code_challenge_method": "S256",
            "code_challenge": code_challenge,
        }
    )
    return f"{SPOTIFY_ACCOUNT_BASE}/authorize?{query}"


def _spotify_basic_auth_header() -> str:
    client_id, client_secret = require_spotify_credentials()
    token = f"{client_id}:{client_secret}".encode("utf-8")
    return base64.b64encode(token).decode("ascii")


def _request_spotify_tokens(payload: dict[str, str]) -> dict[str, Any]:
    response = requests.post(
        f"{SPOTIFY_ACCOUNT_BASE}/api/token",
        headers={
            "Authorization": f"Basic {_spotify_basic_auth_header()}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        data=payload,
        timeout=20,
    )

    if not response.ok:
        raise RuntimeError(f"Spotify token request failed: {response.text}")

    return response.json()


def exchange_code_for_tokens(code: str, code_verifier: str) -> dict[str, Any]:
    settings = get_settings()
    return _request_spotify_tokens(
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": settings.spotify_callback_url,
            "code_verifier": code_verifier,
        }
    )


def refresh_spotify_tokens(refresh_token: str) -> dict[str, Any]:
    return _request_spotify_tokens(
        {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }
    )


def fetch_spotify_profile(access_token: str) -> dict[str, Any]:
    response = requests.get(
        f"{SPOTIFY_API_BASE}/me",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=20,
    )

    if not response.ok:
        raise RuntimeError(f"Unable to fetch Spotify profile: {response.text}")

    return response.json()


def get_valid_spotify_access_token(
    db: Session,
    session_id: str,
    force_refresh: bool = False,
) -> tuple[str, SpotifyConnectionModel]:
    connection = db.scalar(
        select(SpotifyConnectionModel).where(
            SpotifyConnectionModel.session_id == session_id
        )
    )

    if not connection:
        raise RuntimeError("Spotify account is not connected.")

    cached_access_token = decrypt_string(connection.encrypted_access_token)
    expires_at = ensure_utc_datetime(connection.access_token_expires_at)
    expires_soon = expires_at <= (utc_now() + timedelta(minutes=1))

    if not force_refresh and not expires_soon:
        return cached_access_token, connection

    refresh_token = decrypt_string(connection.encrypted_refresh_token)
    if not refresh_token:
        raise RuntimeError("Spotify refresh token is missing. Please reconnect Spotify.")

    refreshed = refresh_spotify_tokens(refresh_token)
    next_refresh_token = refreshed.get("refresh_token") or refresh_token
    connection.encrypted_access_token = encrypt_string(refreshed["access_token"])
    connection.encrypted_refresh_token = encrypt_string(next_refresh_token)
    connection.access_token_expires_at = utc_now() + timedelta(seconds=refreshed["expires_in"])
    connection.scope = refreshed.get("scope") or connection.scope
    connection.updated_at = utc_now()
    db.add(connection)
    db.commit()
    db.refresh(connection)

    return refreshed["access_token"], connection


def _build_spotify_api_url(path: str, query: dict[str, Any] | None = None) -> str:
    if not query:
        return f"{SPOTIFY_API_BASE}{path}"

    filtered = {
        key: value
        for key, value in query.items()
        if value is not None and value != ""
    }
    return f"{SPOTIFY_API_BASE}{path}?{urlencode(filtered)}"


def spotify_api_request(
    db: Session,
    session_id: str,
    path: str,
    *,
    method: str = "GET",
    query: dict[str, Any] | None = None,
    body: dict[str, Any] | None = None,
    allow_no_content: bool = False,
) -> Any:
    url = _build_spotify_api_url(path, query)

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

    access_token, _ = get_valid_spotify_access_token(db, session_id)
    response = _make_request(access_token)

    if response.status_code == 401:
        access_token, _ = get_valid_spotify_access_token(db, session_id, True)
        response = _make_request(access_token)

    if response.status_code in {202, 204}:
        return None

    if not response.ok:
        raise RuntimeError(f"Spotify API request failed: {response.text}")

    return response.json()


def normalize_playback_state(playback: dict[str, Any] | None) -> dict[str, Any] | None:
    if not playback:
        return None

    device = playback.get("device") or {}
    context = playback.get("context") or {}
    item = playback.get("item")

    return {
        "isPlaying": playback.get("is_playing", False),
        "progressMs": playback.get("progress_ms") or 0,
        "deviceName": device.get("name"),
        "volumePercent": device.get("volume_percent"),
        "context": {
            "uri": context.get("uri"),
            "type": context.get("type"),
        }
        if context
        else None,
        "item": {
            "name": item.get("name"),
            "artists": [artist.get("name") for artist in item.get("artists", [])],
            "albumName": item.get("album", {}).get("name"),
            "durationMs": item.get("duration_ms"),
            "imageUrl": (item.get("album", {}).get("images") or [{}])[0].get("url"),
            "uri": item.get("uri"),
        }
        if item
        else None,
    }


def get_current_playback_state(db: Session, session_id: str) -> dict[str, Any] | None:
    playback = spotify_api_request(
        db,
        session_id,
        "/me/player",
        query={"additional_types": "track"},
        allow_no_content=True,
    )
    return normalize_playback_state(playback)


def get_browser_playback_token(db: Session, session_id: str) -> str:
    access_token, _ = get_valid_spotify_access_token(db, session_id)
    return access_token


def get_playlist_cover_image(db: Session, session_id: str, playlist_id: str) -> str | None:
    images = spotify_api_request(db, session_id, f"/playlists/{playlist_id}/images")
    if not images:
        return None
    return images[0].get("url")


def search_tracks(
    db: Session,
    session_id: str,
    query: str,
    limit: int = 5,
) -> list[dict[str, Any]]:
    response = spotify_api_request(
        db,
        session_id,
        "/search",
        query={"q": query, "type": "track", "limit": limit},
    )

    return [
        {
            "name": track.get("name"),
            "uri": track.get("uri"),
            "artists": [artist.get("name") for artist in track.get("artists", [])],
            "albumName": track.get("album", {}).get("name"),
            "durationMs": track.get("duration_ms"),
            "imageUrl": ((track.get("album", {}).get("images")) or [{}])[0].get("url"),
        }
        for track in (response.get("tracks", {}).get("items") or [])
    ]


def search_playlists(
    db: Session,
    session_id: str,
    query: str,
    limit: int = 5,
) -> list[dict[str, Any]]:
    response = spotify_api_request(
        db,
        session_id,
        "/search",
        query={"q": query, "type": "playlist", "limit": limit},
    )

    playlists = response.get("playlists", {}).get("items") or []
    results: list[dict[str, Any]] = []
    for playlist in playlists:
        image_url = ((playlist.get("images")) or [{}])[0].get("url")
        if not image_url:
            image_url = get_playlist_cover_image(db, session_id, playlist["id"])

        results.append(
            {
                "id": playlist.get("id"),
                "name": playlist.get("name"),
                "uri": playlist.get("uri"),
                "description": playlist.get("description"),
                "ownerName": (playlist.get("owner") or {}).get("display_name"),
                "trackCount": (playlist.get("items") or {}).get("total"),
                "imageUrl": image_url,
            }
        )

    return results


def get_preferred_device_id(db: Session, session_id: str) -> str | None:
    connection = db.scalar(
        select(SpotifyConnectionModel.player_device_id).where(
            SpotifyConnectionModel.session_id == session_id
        )
    )
    return connection


def play_track_uris(db: Session, session_id: str, uris: list[str]) -> None:
    spotify_api_request(
        db,
        session_id,
        "/me/player/play",
        method="PUT",
        query={"device_id": get_preferred_device_id(db, session_id)},
        body={"uris": uris},
        allow_no_content=True,
    )


def play_playlist(db: Session, session_id: str, context_uri: str) -> None:
    spotify_api_request(
        db,
        session_id,
        "/me/player/play",
        method="PUT",
        query={"device_id": get_preferred_device_id(db, session_id)},
        body={"context_uri": context_uri},
        allow_no_content=True,
    )


def pause_playback(db: Session, session_id: str) -> None:
    spotify_api_request(
        db,
        session_id,
        "/me/player/pause",
        method="PUT",
        query={"device_id": get_preferred_device_id(db, session_id)},
        allow_no_content=True,
    )


def resume_playback(db: Session, session_id: str) -> None:
    spotify_api_request(
        db,
        session_id,
        "/me/player/play",
        method="PUT",
        query={"device_id": get_preferred_device_id(db, session_id)},
        allow_no_content=True,
    )


def skip_to_next(db: Session, session_id: str) -> None:
    spotify_api_request(
        db,
        session_id,
        "/me/player/next",
        method="POST",
        query={"device_id": get_preferred_device_id(db, session_id)},
        allow_no_content=True,
    )


def skip_to_previous(db: Session, session_id: str) -> None:
    spotify_api_request(
        db,
        session_id,
        "/me/player/previous",
        method="POST",
        query={"device_id": get_preferred_device_id(db, session_id)},
        allow_no_content=True,
    )


def set_volume(db: Session, session_id: str, volume_percent: int) -> None:
    spotify_api_request(
        db,
        session_id,
        "/me/player/volume",
        method="PUT",
        query={
            "volume_percent": volume_percent,
            "device_id": get_preferred_device_id(db, session_id),
        },
        allow_no_content=True,
    )


def queue_track(db: Session, session_id: str, uri: str) -> None:
    spotify_api_request(
        db,
        session_id,
        "/me/player/queue",
        method="POST",
        query={"uri": uri, "device_id": get_preferred_device_id(db, session_id)},
        allow_no_content=True,
    )


def transfer_playback_to_device(db: Session, session_id: str, device_id: str) -> None:
    spotify_api_request(
        db,
        session_id,
        "/me/player",
        method="PUT",
        body={"device_ids": [device_id], "play": False},
        allow_no_content=True,
    )


def set_preferred_player_device(db: Session, session_id: str, device_id: str) -> None:
    connection = db.scalar(
        select(SpotifyConnectionModel).where(
            SpotifyConnectionModel.session_id == session_id
        )
    )
    if not connection:
        raise RuntimeError("Spotify account is not connected.")

    connection.player_device_id = device_id
    connection.updated_at = utc_now()
    db.add(connection)
    db.commit()
    transfer_playback_to_device(db, session_id, device_id)
