"""Fernet ile şifrelenmiş kayıtlar cryptography sürüm yükseltmelerinden sağ çıkmalı."""

import base64
import hashlib

from cryptography.fernet import Fernet

from app.core.crypto import ENCRYPTED_PREFIX, decrypt_value, encrypt_value

# cryptography 48.0.1 ile üretildi; yükseltmeden sonra da çözülebilmeli, aksi halde
# veritabanındaki mevcut credential'lar okunamaz hale gelir.
LEGACY_KEY = b"TQTgrNrns3MY7ritXlaDry6tpGx6RBteRFN5FsIcXPs="
LEGACY_CIPHERTEXT = (
    b"gAAAAABqhBYsqgTLyNK8VfJFsYRnTLe_bfrxs3NXEAfUnPlFrG7tuznaIUck2T4UpbVzYFWavjChHLzFo865"
    b"tkQL8iPReAy03BzMQwIhSiTjNYK7q6lPnEA="
)


def test_legacy_ciphertext_still_decrypts():
    assert Fernet(LEGACY_KEY).decrypt(LEGACY_CIPHERTEXT) == b"embark-refresh-token-ornegi"


def test_legacy_key_derivation_is_unchanged():
    """encrypt_value'nun ENCRYPTION_KEY yokken kullandığı türetme sabit kalmalı."""
    derived = base64.urlsafe_b64encode(hashlib.sha256(b"sabit-test-anahtari").digest())

    assert derived == LEGACY_KEY


def test_encrypt_decrypt_round_trip():
    encrypted = encrypt_value("gizli-deger")

    assert encrypted.startswith(ENCRYPTED_PREFIX)
    assert encrypted != "gizli-deger"
    assert decrypt_value(encrypted) == "gizli-deger"


def test_plaintext_passes_through_untouched():
    assert decrypt_value("sifrelenmemis") == "sifrelenmemis"
