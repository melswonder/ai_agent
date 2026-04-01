from __future__ import annotations

from pydantic import BaseModel, Field


class DevicePayload(BaseModel):
    deviceId: str = Field(min_length=1)


class ChatPayload(BaseModel):
    message: str = Field(min_length=1, max_length=400)

