"""Zentrale Konfiguration und Laufzeit-Einstellungen."""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
BACKUP_DIR = DATA_DIR / "backups"
CACHE_DIR = DATA_DIR / "cache"
STORE_PATH = DATA_DIR / "store.json"
SETTINGS_PATH = DATA_DIR / "settings.json"
ENV_PATH = BASE_DIR / ".env"

for _d in (DATA_DIR, UPLOAD_DIR, BACKUP_DIR, CACHE_DIR):
    _d.mkdir(parents=True, exist_ok=True)

load_dotenv(ENV_PATH)

DEFAULT_SETTINGS = {
    "geminiModel": "gemini-2.5-flash",
    "geminiOcrModel": "gemini-2.5-flash",
    "maxPages": 40,
    "ocrDpi": 200,
    "ocrBatchSize": 6,
    "textDensityThreshold": 140,
    "temperature": 0.0,
    "requestTimeout": 300,
    "maxUploadMb": 80,
    "autoDeriveOnSave": True,
}

_lock = threading.RLock()


def _read_settings() -> dict:
    data = dict(DEFAULT_SETTINGS)
    if SETTINGS_PATH.exists():
        try:
            data.update(json.loads(SETTINGS_PATH.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            pass
    return data


def get_settings() -> dict:
    with _lock:
        s = _read_settings()
        s["geminiKeyConfigured"] = bool(get_api_key())
        s["geminiKeyHint"] = _mask(get_api_key())
        s["geminiKeySource"] = _key_source()
        return s


def update_settings(patch: dict) -> dict:
    with _lock:
        s = _read_settings()
        for k, v in patch.items():
            if k in DEFAULT_SETTINGS:
                s[k] = v
        SETTINGS_PATH.write_text(json.dumps(s, indent=2, ensure_ascii=False), encoding="utf-8")
    return get_settings()


# --------------------------------------------------------------------------
# API-Key-Handling
# --------------------------------------------------------------------------
_KEY_ENV_NAMES = ("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_API_KEY")


def _key_source() -> str | None:
    for name in _KEY_ENV_NAMES:
        if os.environ.get(name):
            return name
    return None


def get_api_key() -> str | None:
    for name in _KEY_ENV_NAMES:
        val = os.environ.get(name)
        if val and val.strip():
            return val.strip()
    return None


def set_api_key(key: str) -> None:
    """Schreibt den Key nach .env und in die laufende Prozessumgebung."""
    key = (key or "").strip()
    with _lock:
        lines = []
        if ENV_PATH.exists():
            lines = [ln for ln in ENV_PATH.read_text(encoding="utf-8").splitlines()
                     if not ln.strip().startswith("GEMINI_API_KEY=")]
        if key:
            lines.append(f"GEMINI_API_KEY={key}")
        ENV_PATH.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")
        if key:
            os.environ["GEMINI_API_KEY"] = key
        else:
            for name in _KEY_ENV_NAMES:
                os.environ.pop(name, None)


def _mask(key: str | None) -> str | None:
    if not key:
        return None
    if len(key) <= 10:
        return "*" * len(key)
    return f"{key[:6]}…{key[-4:]}"
