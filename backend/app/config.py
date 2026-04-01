from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from dotenv import load_dotenv
from pydantic import BaseModel


ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env.local")
load_dotenv(ROOT_DIR / ".env", override=False)


def _empty_to_none(value: str | None) -> str | None:
    if value is None:
        return None

    trimmed = value.strip()
    return trimmed or None


class Settings(BaseModel):
    app_url: str = "https://127.0.0.1:8000"
    database_url: str = (
        "postgresql://postgres:postgres@localhost:5432/spotify_agent?schema=public"
    )
    session_secret: str | None = None
    openai_api_key: str | None = None
    openai_model: str = "gpt-4.1-mini"
    spotify_client_id: str | None = None
    spotify_client_secret: str | None = None
    spotify_callback_url: str = "https://127.0.0.1:8000/callbacks"
    spotify_token_encryption_key: str | None = None

    @property
    def sqlalchemy_database_url(self) -> str:
        raw_url = self.database_url

        if raw_url.startswith("postgresql://"):
            raw_url = raw_url.replace("postgresql://", "postgresql+psycopg2://", 1)

        if not raw_url.startswith("postgresql+"):
            return raw_url

        parts = urlsplit(raw_url)
        query = dict(parse_qsl(parts.query, keep_blank_values=True))
        schema = query.pop("schema", None)

        if schema and schema != "public":
            existing_options = query.get("options", "").strip()
            search_path_option = f"-csearch_path={schema}"
            query["options"] = (
                f"{existing_options} {search_path_option}".strip()
                if existing_options
                else search_path_option
            )

        return urlunsplit(
            (
                parts.scheme,
                parts.netloc,
                parts.path,
                urlencode(query),
                parts.fragment,
            )
        )

    @property
    def spotify_configured(self) -> bool:
        return bool(
            self.spotify_client_id
            and self.spotify_client_secret
            and self.spotify_callback_url
        )

    @property
    def llm_configured(self) -> bool:
        return bool(self.openai_api_key)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings(
        app_url=os.getenv("APP_URL", "https://127.0.0.1:8000"),
        database_url=os.getenv(
            "DATABASE_URL",
            "postgresql://postgres:postgres@localhost:5432/spotify_agent?schema=public",
        ),
        session_secret=_empty_to_none(os.getenv("SESSION_SECRET")),
        openai_api_key=_empty_to_none(os.getenv("OPENAI_API_KEY")),
        openai_model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
        spotify_client_id=_empty_to_none(os.getenv("SPOTIFY_CLIENT_ID")),
        spotify_client_secret=_empty_to_none(os.getenv("SPOTIFY_CLIENT_SECRET")),
        spotify_callback_url=os.getenv(
            "SPOTIFY_CALLBACK_URL",
            "https://127.0.0.1:8000/callbacks",
        ),
        spotify_token_encryption_key=_empty_to_none(
            os.getenv("SPOTIFY_TOKEN_ENCRYPTION_KEY")
        ),
    )


def require_session_secret() -> str:
    secret = get_settings().session_secret
    if not secret:
        raise RuntimeError("SESSION_SECRET is required.")
    return secret


def require_encryption_key() -> str:
    key = get_settings().spotify_token_encryption_key
    if not key:
        raise RuntimeError("SPOTIFY_TOKEN_ENCRYPTION_KEY is required.")
    return key


def require_openai_api_key() -> str:
    api_key = get_settings().openai_api_key
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required.")
    return api_key


def require_spotify_credentials() -> tuple[str, str]:
    settings = get_settings()
    if not settings.spotify_client_id or not settings.spotify_client_secret:
        raise RuntimeError(
            "SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be configured."
        )

    return settings.spotify_client_id, settings.spotify_client_secret
