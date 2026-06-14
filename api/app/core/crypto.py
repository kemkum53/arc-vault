"""Credential encryption using Fernet symmetric encryption."""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

ENCRYPTED_PREFIX = "enc:"

_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        if settings.encryption_key:
            key = settings.encryption_key.encode()
        else:
            digest = hashlib.sha256(settings.jwt_secret.encode()).digest()
            key = base64.urlsafe_b64encode(digest)
        _fernet = Fernet(key)
    return _fernet


def encrypt_value(plaintext: str) -> str:
    encrypted = _get_fernet().encrypt(plaintext.encode()).decode()
    return ENCRYPTED_PREFIX + encrypted


def decrypt_value(ciphertext: str) -> str:
    if not ciphertext.startswith(ENCRYPTED_PREFIX):
        return ciphertext
    try:
        return _get_fernet().decrypt(ciphertext[len(ENCRYPTED_PREFIX):].encode()).decode()
    except InvalidToken:
        return ciphertext
