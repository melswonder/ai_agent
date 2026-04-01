from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class SessionModel(Base):
    __tablename__ = "Session"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    oauth_state: Mapped[str | None] = mapped_column("oauthState", String, unique=True)
    oauth_verifier: Mapped[str | None] = mapped_column("oauthVerifier", String)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column("updatedAt", DateTime(timezone=True))


class SpotifyConnectionModel(Base):
    __tablename__ = "SpotifyConnection"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    session_id: Mapped[str] = mapped_column(
        "sessionId",
        String,
        ForeignKey("Session.id", ondelete="CASCADE"),
        unique=True,
    )
    spotify_user_id: Mapped[str] = mapped_column("spotifyUserId", String, unique=True)
    display_name: Mapped[str | None] = mapped_column("displayName", String)
    scope: Mapped[str] = mapped_column(String)
    encrypted_access_token: Mapped[str] = mapped_column("encryptedAccessToken", Text)
    encrypted_refresh_token: Mapped[str] = mapped_column("encryptedRefreshToken", Text)
    access_token_expires_at: Mapped[datetime] = mapped_column(
        "accessTokenExpiresAt",
        DateTime(timezone=True),
    )
    player_device_id: Mapped[str | None] = mapped_column("playerDeviceId", String)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column("updatedAt", DateTime(timezone=True))


class ChatMessageModel(Base):
    __tablename__ = "ChatMessage"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    session_id: Mapped[str] = mapped_column(
        "sessionId",
        String,
        ForeignKey("Session.id", ondelete="CASCADE"),
    )
    role: Mapped[str] = mapped_column(
        Enum("USER", "ASSISTANT", name="ChatRole", native_enum=True),
    )
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=True))

