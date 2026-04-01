from __future__ import annotations

from pydantic import BaseModel, Field


class DevicePayload(BaseModel):
    deviceId: str = Field(min_length=1)


class ChatPayload(BaseModel):
    message: str = Field(min_length=1, max_length=400)


class SpotifyConfigPayload(BaseModel):
    clientId: str = Field(default="", max_length=200)
    clientSecret: str = Field(default="", max_length=400)
