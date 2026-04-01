from __future__ import annotations

import base64
import hashlib
import hmac
import os
from secrets import compare_digest

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from backend.app.config import require_encryption_key, require_session_secret


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _derive_key(secret: str) -> bytes:
    return hashlib.sha256(secret.encode("utf-8")).digest()


def encrypt_string(value: str) -> str:
    iv = os.urandom(12)
    aesgcm = AESGCM(_derive_key(require_encryption_key()))
    encrypted_with_tag = aesgcm.encrypt(iv, value.encode("utf-8"), None)
    encrypted = encrypted_with_tag[:-16]
    tag = encrypted_with_tag[-16:]
    return ".".join(
        [
            _b64url_encode(iv),
            _b64url_encode(tag),
            _b64url_encode(encrypted),
        ]
    )


def decrypt_string(payload: str) -> str:
    parts = payload.split(".")
    if len(parts) != 3:
        raise RuntimeError("Encrypted token payload is malformed.")

    iv, tag, encrypted = (_b64url_decode(part) for part in parts)
    aesgcm = AESGCM(_derive_key(require_encryption_key()))
    decrypted = aesgcm.decrypt(iv, encrypted + tag, None)
    return decrypted.decode("utf-8")


def _signature_for(value: str) -> str:
    digest = hmac.new(
        require_session_secret().encode("utf-8"),
        value.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return _b64url_encode(digest)


def sign_value(value: str) -> str:
    return f"{value}.{_signature_for(value)}"


def unsign_value(signed_value: str | None) -> str | None:
    if not signed_value or "." not in signed_value:
        return None

    value, provided_signature = signed_value.rsplit(".", 1)
    expected_signature = _signature_for(value)

    if not compare_digest(provided_signature, expected_signature):
        return None

    return value
